using Hms.Api.Infrastructure.Errors;
using Hms.Api.Infrastructure.Tenancy;
using Hms.Api.Features.Dashboard;
using Hms.Domain.Appointments;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Hms.Api.Features.Appointments.CreateAppointment;

public sealed class Handler
{
    private readonly HmsDbContext _dbContext;
    private readonly ITenantContext _tenantContext;
    private readonly DashboardStatsCache _dashboardCache;

    public Handler(
        HmsDbContext dbContext,
        ITenantContext tenantContext,
        DashboardStatsCache dashboardCache)
    {
        _dbContext = dbContext;
        _tenantContext = tenantContext;
        _dashboardCache = dashboardCache;
    }

    public async Task<Appointment> HandleAsync(
        Command command,
        CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.TenantId;

        if (tenantId is null)
        {
            throw new ValidationException(
                "Tenant context is required.");
        }

        if (command.ClientOperationId is Guid operationId)
        {
            if (operationId == Guid.Empty)
            {
                throw new ValidationException(
                    "Client operation ID must be a non-empty GUID.");
            }

            var existing = await _dbContext.Appointments
                .AsNoTracking()
                .SingleOrDefaultAsync(
                    x => x.Id == operationId && x.TenantId == tenantId.Value,
                    cancellationToken);
            if (existing is not null)
            {
                if (Matches(existing, command))
                {
                    return existing;
                }

                throw new ConflictException(
                    "This appointment operation ID was already used for different data.");
            }
        }

        if (command.ScheduledAtUtc.Kind != DateTimeKind.Utc)
        {
            throw new ValidationException(
                "Appointment date and time must be provided in UTC.");
        }

        if (command.ScheduledAtUtc <= DateTime.UtcNow)
        {
            throw new ValidationException(
                "Appointment must be scheduled in the future.");
        }

        if (string.IsNullOrWhiteSpace(command.Reason) ||
            command.Reason.Trim().Length > 500)
        {
            throw new ValidationException(
                "Appointment reason is required and must be 500 characters or fewer.");
        }

        var patientExists = await _dbContext.Patients
            .AnyAsync(x =>
                x.Id == command.PatientId &&
                x.TenantId == tenantId.Value);

        if (!patientExists)
        {
            throw new ValidationException(
                "Patient not found.");
        }

        var appointment = new Appointment(
            command.ClientOperationId ?? Guid.NewGuid(),
            tenantId.Value,
            command.PatientId,
            command.ScheduledAtUtc,
            command.Reason.Trim());

        _dbContext.Appointments.Add(appointment);
        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception)
            when (exception.InnerException is PostgresException
            {
                SqlState: PostgresErrorCodes.UniqueViolation,
                ConstraintName: "PK_appointments"
            } && command.ClientOperationId is not null)
        {
            _dbContext.Entry(appointment).State = EntityState.Detached;
            var existing = await _dbContext.Appointments
                .AsNoTracking()
                .SingleOrDefaultAsync(
                    x => x.Id == command.ClientOperationId &&
                         x.TenantId == tenantId.Value,
                    cancellationToken);

            if (existing is not null && Matches(existing, command))
            {
                return existing;
            }

            throw new ConflictException(
                "This appointment operation ID was already used.");
        }

        await _dashboardCache.InvalidateAsync(tenantId.Value, cancellationToken);
        return appointment;
    }

    private static bool Matches(Appointment existing, Command command) =>
        existing.PatientId == command.PatientId &&
        existing.ScheduledAtUtc == command.ScheduledAtUtc &&
        existing.Reason == command.Reason.Trim();
}