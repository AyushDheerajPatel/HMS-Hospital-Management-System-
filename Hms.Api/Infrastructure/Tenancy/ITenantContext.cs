namespace Hms.Api.Infrastructure.Tenancy;

public interface ITenantContext
{
    Guid? TenantId { get; }

    void SetTenant(Guid tenantId);
}