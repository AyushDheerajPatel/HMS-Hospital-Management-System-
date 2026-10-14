using Hms.Api.Infrastructure.Errors;
using Hms.Domain.Appointments;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Hms.Api.Features.Appointments.DoctorScheduling;

internal static class AppointmentScheduling
{
    public const int SlotDurationMinutes = 30;

    private static readonly TimeSpan SlotDuration =
        TimeSpan.FromMinutes(SlotDurationMinutes);

    public static async Task<bool> LockDoctorAsync(
        HmsDbContext dbContext,
        Guid doctorId,
        CancellationToken cancellationToken)
    {
        var doctor = await dbContext.Users
            .FromSqlInterpolated(
                $"SELECT * FROM users WHERE \"Id\" = {doctorId} FOR UPDATE")
            .AsNoTracking()
            .SingleOrDefaultAsync(cancellationToken);
        return doctor is not null;
    }

    public static async Task EnsureDoctorBelongsToTenantAsync(
        HmsDbContext dbContext,
        Guid tenantId,
        Guid doctorId,
        CancellationToken cancellationToken)
    {
        var isDoctor = await dbContext.TenantMemberships
            .AnyAsync(
                membership =>
                    membership.TenantId == tenantId &&
                    membership.UserId == doctorId &&
                    membership.Role.ToLower() == "doctor",
                cancellationToken);
        if (!isDoctor)
        {
            throw new ValidationException(
                "The selected doctor is not a member of this hospital.");
        }
    }

    public static async Task EnsureSlotAvailableAsync(
        HmsDbContext dbContext,
        Guid tenantId,
        Guid doctorId,
        DateTime scheduledAtUtc,
        Guid? excludedAppointmentId,
        CancellationToken cancellationToken)
    {
        if (scheduledAtUtc.Kind != DateTimeKind.Utc)
        {
            throw new ValidationException(
                "Appointment date and time must be provided in UTC.");
        }

        var date = DateOnly.FromDateTime(scheduledAtUtc);
        var availability = await dbContext.DoctorAvailabilities
            .AsNoTracking()
            .SingleOrDefaultAsync(
                item =>
                    item.TenantId == tenantId &&
                    item.DoctorId == doctorId &&
                    item.Date == date,
                cancellationToken);
        if (availability is null)
        {
            throw new ConflictException(
                "The selected doctor has no availability configured for this date.");
        }

        var startTime = TimeOnly.FromDateTime(scheduledAtUtc);
        var slotOffset = startTime.Ticks - availability.StartTimeUtc.Ticks;
        if (slotOffset < 0 ||
            slotOffset % SlotDuration.Ticks != 0 ||
            startTime.Add(SlotDuration) > availability.EndTimeUtc ||
            scheduledAtUtc <= DateTime.UtcNow)
        {
            throw new ConflictException(
                "The selected time is outside the doctor's available appointment slots.");
        }

        var appointmentEnd = scheduledAtUtc.Add(SlotDuration);
        var earliestRelevantStartUtc = scheduledAtUtc.Subtract(SlotDuration);
        var occupiedAppointments = await dbContext.Appointments
            .AsNoTracking()
            .Where(appointment =>
                appointment.TenantId == tenantId &&
                appointment.Status == "scheduled" &&
                appointment.ScheduledAtUtc >= earliestRelevantStartUtc &&
                appointment.ScheduledAtUtc.Add(SlotDuration) > scheduledAtUtc &&
                appointment.ScheduledAtUtc < appointmentEnd &&
                (appointment.DoctorId == doctorId ||
                 appointment.DoctorId == null) &&
                (excludedAppointmentId == null ||
                 appointment.Id != excludedAppointmentId))
            .Select(appointment => appointment.ScheduledAtUtc)
            .ToListAsync(cancellationToken);
        if (occupiedAppointments.Any(existingStart =>
                existingStart < appointmentEnd &&
                existingStart.Add(SlotDuration) > scheduledAtUtc))
        {
            throw new ConflictException(
                "The selected appointment slot was just taken. Choose another available slot.");
        }
    }

    public static bool IsValidAvailabilityWindow(
        TimeOnly startTimeUtc,
        TimeOnly endTimeUtc) =>
        startTimeUtc < endTimeUtc &&
        startTimeUtc.Ticks % SlotDuration.Ticks == 0 &&
        endTimeUtc.Ticks % SlotDuration.Ticks == 0 &&
        endTimeUtc - startTimeUtc >= SlotDuration;
}
