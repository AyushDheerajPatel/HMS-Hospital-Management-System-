namespace Hms.Api.Features.Tenants.RegisterTenant;

public sealed record Command(
    string Name,
    string Slug,
    string AdministratorEmail,
    string AdministratorPassword
);
