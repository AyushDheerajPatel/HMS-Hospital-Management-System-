namespace Hms.Api.Features.Tenants.CreateTenant;

public sealed record Command(
    string Name,
    string Slug
);