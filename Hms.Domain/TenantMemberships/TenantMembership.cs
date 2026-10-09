namespace Hms.Domain.TenantMemberships;

public sealed class TenantMembership
{
    public Guid Id { get; private set; }

    public Guid UserId { get; private set; }

    public Guid TenantId { get; private set; }

    public string Role { get; private set; }

    public TenantMembership(
        Guid id,
        Guid userId,
        Guid tenantId,
        string role)
    {
        Id = id;
        UserId = userId;
        TenantId = tenantId;
        Role = role;
    }
}