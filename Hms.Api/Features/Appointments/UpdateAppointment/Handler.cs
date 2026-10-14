using Hms.Api.Features.Appointments;
using Hms.Api.Features.Appointments.DoctorScheduling;
using Hms.Api.Features.Dashboard;
using Hms.Api.Features.Realtime;
using Hms.Api.Infrastructure.Errors;
using Hms.Api.Infrastructure.Tenancy;
using Hms.Domain.Appointments;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Hms.Api.Features.Appointments.UpdateAppointment;

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

    public async Task<Appointment> HandleAsync(
        Guid appointmentId,
        Command command,
        CancellationToken cancellationToken)
    {
        var tenantId = _tenantContext.TenantId
            ?? throw new ValidationException("Tenant context is required.");
        if (command.ExpectedVersion < 1)
        {
            throw new ValidationException("A valid appointment version is required.");
        }

        if (command.ScheduledAtUtc.Kind != DateTimeKind.Utc ||
            command.ScheduledAtUtc <= DateTime.UtcNow)
        {
            throw new ValidationException(
                "Appointment date and time must be in the future and provided in UTC.");
        }

        if (string.IsNullOrWhiteSpace(command.Reason) ||
            command.Reason.Trim().Length > 500)
        {
            throw new ValidationException(
                "Appointment reason is required and must be 500 characters or fewer.");
        }

        await using var transaction = await _dbContext.Database
            .BeginTransactionAsync(cancellationToken);
        var appointment = await _dbContext.Appointments.SingleOrDefaultAsync(
            x => x.Id == appointmentId && x.TenantId == tenantId,
            cancellationToken)
            ?? throw new ValidationException("Appointment not found.");

        if (appointment.DoctorId is not Guid doctorId)
        {
            throw new ConflictException(
                "This legacy appointment has no assigned doctor and cannot be edited.");
        }

        await AppointmentScheduling.LockDoctorAsync(
            _dbContext,
            doctorId,
            cancellationToken);
        await _dbContext.Entry(appointment).ReloadAsync(cancellationToken);

        if (appointment.Version != command.ExpectedVersion)
        {
            throw new ConflictException(
                "This appointment was changed by another user. Refresh and try again.");
        }

        if (appointment.Status != "scheduled")
        {
            throw new ConflictException(
                "Only scheduled appointments can be edited.");
        }

        var patientExists = await _dbContext.Patients.AnyAsync(
            x => x.Id == command.PatientId && x.TenantId == tenantId,
            cancellationToken);
        if (!patientExists)
        {
            throw new ValidationException("Patient not found.");
        }

        await AppointmentScheduling.EnsureDoctorBelongsToTenantAsync(
            _dbContext,
            tenantId,
            doctorId,
            cancellationToken);
        await AppointmentScheduling.EnsureSlotAvailableAsync(
            _dbContext,
            tenantId,
            doctorId,
            command.ScheduledAtUtc,
            appointment.Id,
            cancellationToken);
        appointment.UpdateDetails(
            command.PatientId,
            command.ScheduledAtUtc,
            command.Reason.Trim());
        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new ConflictException(
                "This appointment was changed by another user. Refresh and try again.");
        }

        await _dashboardCache.InvalidateAsync(tenantId, cancellationToken);
        _appointmentUpdates.Publish(tenantId, "appointment.changed");
        if (_realtimePublisher is not null)
        {
            await _realtimePublisher.PublishAppointmentChangedAsync(
                tenantId,
                appointment.Id,
                appointment.Status);
        }
        return appointment;
    }
}
