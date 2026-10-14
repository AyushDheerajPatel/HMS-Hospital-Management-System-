using Hms.Api.Features.Appointments;
using Hms.Api.Features.Appointments.DoctorScheduling;
using Hms.Api.Features.Dashboard;
using Hms.Api.Features.Realtime;
using Hms.Api.Infrastructure.Errors;
using Hms.Api.Infrastructure.Tenancy;
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
    private readonly AppointmentUpdates _appointmentUpdates;
    private readonly HospitalRealtimePublisher? _realtimePublisher;

    public Handler(
        HmsDbContext dbContext,
        ITenantContext tenantContext,
        DashboardStatsCache dashboardCache,
        AppointmentUpdates appointmentUpdates)
        : this(dbContext, tenantContext, dashboardCache, appointmentUpdates, null)
    {
    }

    public Handler(
        HmsDbContext dbContext,
        ITenantContext tenantContext,
        DashboardStatsCache dashboardCache,
        AppointmentUpdates appointmentUpdates,
        HospitalRealtimePublisher? realtimePublisher)
    {
        _dbContext = dbContext;
        _tenantContext = tenantContext;
        _dashboardCache = dashboardCache;
        _appointmentUpdates = appointmentUpdates;
        _realtimePublisher = realtimePublisher;
    }

    public async Task<AppointmentResult> HandleAsync(
        Command command,
        CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.TenantId;
        if (tenantId is null)
        {
            throw new ValidationException("Tenant context is required.");
        }

        if (command.ClientOperationId is Guid operationId)
        {
            if (operationId == Guid.Empty)
            {
                throw new ValidationException(
                    "Client operation ID must be a non-empty GUID.");
            }

            var existing = await _dbContext.AppointmentOperations
                .AsNoTracking()
                .SingleOrDefaultAsync(
                    x => x.TenantId == tenantId.Value &&
                         x.ClientOperationId == operationId,
                    cancellationToken);
            if (existing is not null)
            {
                if (!IsSameOperation(existing, command))
                {
                    throw new ConflictException(
                        "This appointment operation ID was already used for different data.");
                }

                await RefreshAppointmentReadModelsAsync(
                    tenantId.Value,
                    cancellationToken);
                return ToResult(existing);
            }
        }

        if (command.DoctorId == Guid.Empty)
        {
            throw new ValidationException("A doctor is required.");
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

        var scheduledAtUtc = NormalizeToDatabasePrecision(
            command.ScheduledAtUtc);
        var createdAtUtc = NormalizeToDatabasePrecision(DateTime.UtcNow);
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
            tenantId.Value,
            command.DoctorId,
            cancellationToken);

        if (command.ClientOperationId is Guid retryOperationId)
        {
            var existing = await _dbContext.AppointmentOperations
                .AsNoTracking()
                .SingleOrDefaultAsync(
                    item =>
                        item.TenantId == tenantId.Value &&
                        item.ClientOperationId == retryOperationId,
                    cancellationToken);
            if (existing is not null)
            {
                if (!IsSameOperation(existing, command))
                {
                    throw new ConflictException(
                        "This appointment operation ID was already used for different data.");
                }

                await transaction.CommitAsync(cancellationToken);
                return ToResult(existing);
            }
        }

        var patientExists = await _dbContext.Patients
            .AnyAsync(
                patient =>
                    patient.Id == command.PatientId &&
                    patient.TenantId == tenantId.Value,
                cancellationToken);
        if (!patientExists)
        {
            throw new ValidationException("Patient not found.");
        }

        await AppointmentScheduling.EnsureSlotAvailableAsync(
            _dbContext,
            tenantId.Value,
            command.DoctorId,
            scheduledAtUtc,
            null,
            cancellationToken);

        var appointmentId = Guid.NewGuid();
        var appointment = new Appointment(
            appointmentId,
            tenantId.Value,
            command.PatientId,
            command.DoctorId,
            scheduledAtUtc,
            command.Reason.Trim(),
            createdAtUtc);
        AppointmentOperation? operation = null;
        if (command.ClientOperationId is Guid clientOperationId)
        {
            operation = new AppointmentOperation(
                tenantId.Value,
                clientOperationId,
                appointment.Id,
                appointment.PatientId,
                command.DoctorId,
                appointment.ScheduledAtUtc,
                appointment.Reason,
                appointment.CreatedAtUtc);
            _dbContext.AppointmentOperations.Add(operation);
        }

        _dbContext.Appointments.Add(appointment);
        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception)
            when (exception.InnerException is PostgresException
            {
                SqlState: PostgresErrorCodes.UniqueViolation,
                ConstraintName: "PK_appointment_operations"
            } && operation is not null)
        {
            await transaction.RollbackAsync(cancellationToken);
            _dbContext.Entry(appointment).State = EntityState.Detached;
            _dbContext.Entry(operation).State = EntityState.Detached;
            var existing = await _dbContext.AppointmentOperations
                .AsNoTracking()
                .SingleOrDefaultAsync(
                    x => x.TenantId == tenantId.Value &&
                         x.ClientOperationId == operation.ClientOperationId,
                    cancellationToken);

            if (existing is not null && IsSameOperation(existing, command))
            {
                await RefreshAppointmentReadModelsAsync(
                    tenantId.Value,
                    cancellationToken);
                return ToResult(existing);
            }

            throw new ConflictException(
                "This appointment operation ID was already used.");
        }

        await RefreshAppointmentReadModelsAsync(
            tenantId.Value,
            cancellationToken);
        if (_realtimePublisher is not null)
        {
            await _realtimePublisher.PublishAppointmentChangedAsync(
                tenantId.Value,
                appointment.Id,
                appointment.Status);
        }
        return ToResult(appointment);
    }

    private async Task RefreshAppointmentReadModelsAsync(
        Guid tenantId,
        CancellationToken cancellationToken)
    {
        await _dashboardCache.InvalidateAsync(tenantId, cancellationToken);
        _appointmentUpdates.Publish(tenantId, "appointment.changed");
    }

    internal static bool IsSameOperation(
        AppointmentOperation existing,
        Command command) =>
        existing.ClientOperationId == command.ClientOperationId &&
        command.ClientOperationId is not null &&
        !string.IsNullOrWhiteSpace(command.Reason) &&
        existing.PatientId == command.PatientId &&
        existing.DoctorId == command.DoctorId &&
        existing.ScheduledAtUtc ==
            NormalizeToDatabasePrecision(command.ScheduledAtUtc) &&
        existing.Reason == command.Reason.Trim();

    private static DateTime NormalizeToDatabasePrecision(DateTime value) =>
        new(value.Ticks - value.Ticks % 10, DateTimeKind.Utc);

    private static AppointmentResult ToResult(Appointment appointment) =>
        new(
            appointment.Id,
            appointment.TenantId,
            appointment.PatientId,
            appointment.DoctorId,
            appointment.ScheduledAtUtc,
            appointment.Reason,
            appointment.Status,
            appointment.Version,
            appointment.CreatedAtUtc);

    private static AppointmentResult ToResult(AppointmentOperation operation) =>
        new(
            operation.AppointmentId,
            operation.TenantId,
            operation.PatientId,
            operation.DoctorId,
            operation.ScheduledAtUtc,
            operation.Reason,
            "scheduled",
            1,
            operation.CreatedAtUtc);
}

public sealed record AppointmentResult(
    Guid Id,
    Guid TenantId,
    Guid PatientId,
    Guid? DoctorId,
    DateTime ScheduledAtUtc,
    string Reason,
    string Status,
    int Version,
    DateTime CreatedAtUtc);
