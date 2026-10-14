using Hms.Domain.Tenants;
using Hms.Domain.TenantMemberships;
using Hms.Api.Infrastructure.Auth;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Hms.Api.Infrastructure.Errors;

namespace Hms.Api.Features.Tenants.CreateTenant;

public sealed class Handler
{
    private readonly HmsDbContext _dbContext;
    private readonly ICurrentUser _currentUser;

    public Handler(HmsDbContext dbContext, ICurrentUser currentUser)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
    }

    public async Task<Tenant> HandleAsync(Command command)
    {
        Validate(command);

        var userId = _currentUser.UserId
            ?? throw new ValidationException("Authentication is required.");
        var tenant = new Tenant(
            Guid.NewGuid(),
            command.Name.Trim(),
            command.Slug.Trim().ToLowerInvariant());
        var membership = new TenantMembership(
            Guid.NewGuid(),
            userId,
            tenant.Id,
            "admin");

        _dbContext.Tenants.Add(tenant);
        _dbContext.TenantMemberships.Add(membership);

        try
        {
            await _dbContext.SaveChangesAsync();
        }
        catch (DbUpdateException exception)
            when (exception.InnerException is PostgresException postgresException
                  && postgresException.SqlState == "23505"
                  && postgresException.ConstraintName == "IX_tenants_Slug")
        {
            throw new ConflictException(
                $"Tenant slug '{tenant.Slug}' already exists.");
        }

        return tenant;
    }

    private static void Validate(Command command)
    {
        if (string.IsNullOrWhiteSpace(command.Name))
        {
            throw new ValidationException("Name is required.");        }

        if (command.Name.Trim().Length > 200)
        {
            throw new ValidationException(
                "Name must be 200 characters or fewer.");
        }

        if (string.IsNullOrWhiteSpace(command.Slug))
        {
            throw new ValidationException("Slug is required.");
        }

        var slug = command.Slug.Trim().ToLowerInvariant();

        if (slug.Length > 100)
        {
            throw new ValidationException(
                "Slug must be 100 characters or fewer.");
        }

        if (!System.Text.RegularExpressions.Regex.IsMatch(
                slug,
                "^[a-z0-9]+(?:-[a-z0-9]+)*$"))
        {
            throw new ValidationException(
                "Slug must contain only lowercase letters, numbers, and hyphens.");
        }
    }
}
