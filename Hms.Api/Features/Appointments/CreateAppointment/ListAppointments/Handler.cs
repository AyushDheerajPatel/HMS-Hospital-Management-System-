using Hms.Api.Infrastructure.Errors;
using Hms.Api.Infrastructure.Tenancy;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Hms.Api.Features.Appointments.ListAppointments;

public sealed class Handler
{
    private readonly HmsDbContext _dbContext;
    private readonly ITenantContext _tenantContext;

    public Handler(
        HmsDbContext dbContext,
        ITenantContext tenantContext)
    {
        _dbContext = dbContext;
        _tenantContext = tenantContext;
    }

    public async Task<Response> HandleAsync(Query query)
    {
        var tenantId = _tenantContext.TenantId;

        if (tenantId is null)
        {
            throw new ValidationException(
                "Tenant context is required.");
        }

        var page = Math.Max(query.Page, 1);
        var pageSize = Math.Clamp(query.PageSize, 1, 100);

        var appointments = _dbContext.Appointments
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId.Value);

        if (query.PatientId is not null)
        {
            appointments = appointments.Where(x =>
                x.PatientId == query.PatientId.Value);
        }

        if (!string.IsNullOrWhiteSpace(query.Status))
        {
            var status = query.Status.Trim().ToLowerInvariant();

            appointments = appointments.Where(x =>
                x.Status == status);
        }

        if (query.FromUtc is not null)
        {
            appointments = appointments.Where(x =>
                x.ScheduledAtUtc >= query.FromUtc.Value);
        }

        if (query.ToUtc is not null)
        {
            appointments = appointments.Where(x =>
                x.ScheduledAtUtc <= query.ToUtc.Value);
        }

        var totalCount = await appointments.CountAsync();

        var items = await appointments
            .OrderBy(x => x.ScheduledAtUtc)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(x => new AppointmentItem(
                x.Id,
                x.PatientId,
                x.ScheduledAtUtc,
                x.Reason,
                x.Status,
                x.CreatedAtUtc))
            .ToListAsync();

        var totalPages = (int)Math.Ceiling(
            totalCount / (double)pageSize);

        return new Response(
            items,
            page,
            pageSize,
            totalCount,
            totalPages);
    }
}

public sealed record AppointmentItem(
    Guid Id,
    Guid PatientId,
    DateTime ScheduledAtUtc,
    string Reason,
    string Status,
    DateTime CreatedAtUtc
);

public sealed record Response(
    IReadOnlyList<AppointmentItem> Items,
    int Page,
    int PageSize,
    int TotalCount,
    int TotalPages
);
