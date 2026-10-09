namespace Hms.Domain.Tenants;

public sealed class Tenant
{
    public Guid Id { get; private set; }

    public string Name { get; private set; }

    public string Slug { get; private set; }

    public Tenant(
        Guid id,
        string name,
        string slug)
    {
        Id = id;
        Name = name;
        Slug = slug;
    }
}