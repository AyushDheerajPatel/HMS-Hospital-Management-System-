using Hms.Api.Infrastructure.Errors;
using Hms.Api.Infrastructure.Auth;
using Hms.Api.Infrastructure.Tenancy;
using Hms.Domain.Appointments;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Hms.Api.Features.Appointments.DoctorScheduling;

public sealed class Handler
{
    private readonly HmsDbContext _dbContext;
    private readonly ITenantContext _tenantContext;
    private readonly ICurrentUser _currentUser;

    public Handler(
        HmsDbContext dbContext,
        ITenantContext tenantContext,
        ICurrentUser currentUser)
    {
        _dbContext = dbContext;
        _tenantContext = tenantContext;
        _currentUser = currentUser;
    }

    public async Task<IReadOnlyList<DoctorItem>> ListDoctorsAsync(
        CancellationToken cancellationToken)
    {
        var tenantId = GetTenantId();
        return await (
            from membership in _dbContext.TenantMemberships.AsNoTracking()
            join user in _dbContext.Users.AsNoTracking()
                on membership.UserId equals user.Id
            where membership.TenantId == tenantId &&
                  membership.Role.ToLower() == "doctor"
            orderby user.Email
            select new DoctorItem(user.Id, user.Email))
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<DateTime>> GetSlotsAsync(
        Guid doctorId,
        DateOnly date,
        CancellationToken cancellationToken)
    {
        var tenantId = GetTenantId();
        await AppointmentScheduling.EnsureDoctorBelongsToTenantAsync(
            _dbContext,
            tenantId,
            doctorId,
            cancellationToken);

        var availability = await _dbContext.DoctorAvailabilities
            .AsNoTracking()
            .SingleOrDefaultAsync(
                item =>
                    item.TenantId == tenantId &&
                    item.DoctorId == doctorId &&
                    item.Date == date,
                cancellationToken);
        if (availability is null)
        {
            return [];
        }

        var dateStartUtc = date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var earliestRelevantStartUtc = dateStartUtc.AddMinutes(
            -AppointmentScheduling.SlotDurationMinutes);
        var dateEndUtc = dateStartUtc.AddDays(1);
        var occupiedAppointments = await _dbContext.Appointments
            .AsNoTracking()
            .Where(appointment =>
                appointment.TenantId == tenantId &&
                appointment.Status == "scheduled" &&
                appointment.ScheduledAtUtc >= earliestRelevantStartUtc &&
                appointment.ScheduledAtUtc < dateEndUtc &&
                (appointment.DoctorId == doctorId ||
                 appointment.DoctorId == null))
            .Select(appointment => appointment.ScheduledAtUtc)
            .ToListAsync(cancellationToken);

        var now = DateTime.UtcNow;
        var slots = new List<DateTime>();
        for (var start = availability.StartTimeUtc;
             start.AddMinutes(AppointmentScheduling.SlotDurationMinutes) <=
             availability.EndTimeUtc;
             start = start.AddMinutes(AppointmentScheduling.SlotDurationMinutes))
        {
            var slotStart = date.ToDateTime(start, DateTimeKind.Utc);
            var slotEnd = slotStart.AddMinutes(
                AppointmentScheduling.SlotDurationMinutes);
            if (slotStart <= now ||
                occupiedAppointments.Any(existingStart =>
                    existingStart < slotEnd &&
                    existingStart.AddMinutes(
                        AppointmentScheduling.SlotDurationMinutes) > slotStart))
            {
                continue;
            }

            slots.Add(slotStart);
        }

        return slots;
    }

    public async Task<AvailabilityItem> SetAvailabilityAsync(
        SetAvailabilityCommand command,
        CancellationToken cancellationToken)
    {
        var tenantId = GetTenantId();
        if (!AppointmentScheduling.IsValidAvailabilityWindow(
                command.StartTimeUtc,
                command.EndTimeUtc))
        {
            throw new ValidationException(
                "Availability must be a UTC window containing whole 30-minute slots.");
        }

        var nowUtc = DateTime.UtcNow;
        var todayUtc = DateOnly.FromDateTime(nowUtc);
        if (command.Date < todayUtc ||
            (command.Date == todayUtc &&
             command.EndTimeUtc <= TimeOnly.FromDateTime(nowUtc)))
        {
            throw new ValidationException(
                "Availability must include a future UTC appointment slot.");
        }

        await using var transaction = await _dbContext.Database
            .BeginTransactionAsync(cancellationToken);
        if (!await AppointmentScheduling.LockDoctorAsync(
                _dbContext,
                command.DoctorId,
                cancellationToken))
        {
            throw new ValidationException("Doctor not found.");
        }

        await AppointmentScheduling.EnsureDoctorBelongsToTenantAsync(
            _dbContext,
            tenantId,
            command.DoctorId,
            cancellationToken);
        var currentRole = await _dbContext.TenantMemberships
            .AsNoTracking()
            .Where(membership =>
                membership.TenantId == tenantId &&
                membership.UserId == _currentUser.UserId)
            .Select(membership => membership.Role)
            .SingleOrDefaultAsync(cancellationToken);
        if (currentRole is null ||
            (currentRole.ToLowerInvariant() != "admin" &&
             _currentUser.UserId != command.DoctorId))
        {
            throw new ForbiddenException(
                "Only a hospital administrator or the selected doctor may configure availability.");
        }

        var dateStartUtc = command.Date.ToDateTime(
            TimeOnly.MinValue,
            DateTimeKind.Utc);
        var dateEndUtc = dateStartUtc.AddDays(1);
        var windowStartUtc = dateStartUtc.Add(command.StartTimeUtc.ToTimeSpan());
        var windowEndUtc = dateStartUtc.Add(command.EndTimeUtc.ToTimeSpan());
        var hasOutOfWindowAppointments = await _dbContext.Appointments
            .AnyAsync(
                appointment =>
                    appointment.TenantId == tenantId &&
                    appointment.DoctorId == command.DoctorId &&
                    appointment.Status == "scheduled" &&
                    appointment.ScheduledAtUtc >= dateStartUtc &&
                    appointment.ScheduledAtUtc < dateEndUtc &&
                    (appointment.ScheduledAtUtc < windowStartUtc ||
                     appointment.ScheduledAtUtc.AddMinutes(
                         AppointmentScheduling.SlotDurationMinutes) >
                     windowEndUtc),
                cancellationToken);
        if (hasOutOfWindowAppointments)
        {
            throw new ConflictException(
                "Availability cannot exclude an existing scheduled appointment.");
        }

        var availability = await _dbContext.DoctorAvailabilities
            .SingleOrDefaultAsync(
                item =>
                    item.TenantId == tenantId &&
                    item.DoctorId == command.DoctorId &&
                    item.Date == command.Date,
                cancellationToken);
        if (availability is null)
        {
            availability = new DoctorAvailability(
                tenantId,
                command.DoctorId,
                command.Date,
                command.StartTimeUtc,
                command.EndTimeUtc);
            _dbContext.DoctorAvailabilities.Add(availability);
        }
        else
        {
            availability.SetWindow(
                command.StartTimeUtc,
                command.EndTimeUtc);
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new AvailabilityItem(
            availability.DoctorId,
            availability.Date,
            availability.StartTimeUtc,
            availability.EndTimeUtc,
            AppointmentScheduling.SlotDurationMinutes);
    }

    private Guid GetTenantId() =>
        _tenantContext.TenantId
        ?? throw new ValidationException("Tenant context is required.");
}

public sealed record DoctorItem(Guid Id, string Email);

public sealed record AvailabilityItem(
    Guid DoctorId,
    DateOnly Date,
    TimeOnly StartTimeUtc,
    TimeOnly EndTimeUtc,
    int SlotDurationMinutes);
