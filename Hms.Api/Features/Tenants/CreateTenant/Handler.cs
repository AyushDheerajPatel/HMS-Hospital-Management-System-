using Hms.Domain.Tenants;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Hms.Api.Infrastructure.Errors;

namespace Hms.Api.Features.Tenants.CreateTenant;

public sealed class Handler
{
    private readonly HmsDbContext _dbContext;

    public Handler(HmsDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<Tenant> HandleAsync(Command command)
    {
        Validate(command);

        var tenant = new Tenant(
            Guid.NewGuid(),
            command.Name.Trim(),
            command.Slug.Trim().ToLowerInvariant());

        _dbContext.Tenants.Add(tenant);

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
