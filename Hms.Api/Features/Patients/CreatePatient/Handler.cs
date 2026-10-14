using Hms.Api.Infrastructure.Errors;
using Hms.Api.Infrastructure.Tenancy;
using Hms.Api.Features.Dashboard;
using Hms.Domain.Patients;
using Hms.Infrastructure.Persistence;
using System.Net.Mail;

namespace Hms.Api.Features.Patients.CreatePatient;

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

    public async Task<Patient> HandleAsync(
        Command command,
        CancellationToken cancellationToken = default)
    {
        var tenantId = _tenantContext.TenantId;

        if (tenantId is null)
        {
            throw new ValidationException(
                "Tenant context is required.");
        }

        if (string.IsNullOrWhiteSpace(command.FirstName))
        {
            throw new ValidationException(
                "First name is required.");
        }

        if (string.IsNullOrWhiteSpace(command.LastName))
        {
            throw new ValidationException(
                "Last name is required.");
        }

        if (command.FirstName.Trim().Length > 100 ||
            command.LastName.Trim().Length > 100)
        {
            throw new ValidationException(
                "Patient names must be 100 characters or fewer.");
        }

        if (command.DateOfBirth == default)
        {
            throw new ValidationException("Date of birth is required.");
        }

        if (command.DateOfBirth > DateOnly.FromDateTime(DateTime.UtcNow))
        {
            throw new ValidationException(
                "Date of birth cannot be in the future.");
        }

        if (command.Phone?.Trim().Length > 30)
        {
            throw new ValidationException(
                "Phone number must be 30 characters or fewer.");
        }

        var email = command.Email?.Trim().ToLowerInvariant();
        if (email is { Length: > 320 } ||
            (!string.IsNullOrWhiteSpace(email) &&
             (!MailAddress.TryCreate(email, out var parsedEmail) ||
              !string.Equals(
                  parsedEmail.Address,
                  email,
                  StringComparison.OrdinalIgnoreCase))))
        {
            throw new ValidationException("A valid email address is required.");
        }

        var patient = new Patient(
            Guid.NewGuid(),
            tenantId.Value,
            command.FirstName.Trim(),
            command.LastName.Trim(),
            command.DateOfBirth,
            string.IsNullOrWhiteSpace(command.Phone)
                ? null
                : command.Phone.Trim(),
            email);

        _dbContext.Patients.Add(patient);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await _dashboardCache.InvalidateAsync(tenantId.Value, cancellationToken);

        return patient;
    }
}