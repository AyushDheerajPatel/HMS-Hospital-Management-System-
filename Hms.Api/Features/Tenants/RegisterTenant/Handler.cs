using System.Net.Mail;
using Hms.Api.Infrastructure.Errors;
using Hms.Domain.TenantMemberships;
using Hms.Domain.Tenants;
using Hms.Domain.Users;
using Hms.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Hms.Api.Features.Tenants.RegisterTenant;

public sealed class Handler
{
    private readonly HmsDbContext _dbContext;
    private readonly IPasswordHasher<User> _passwordHasher;

    public Handler(
        HmsDbContext dbContext,
        IPasswordHasher<User> passwordHasher)
    {
        _dbContext = dbContext;
        _passwordHasher = passwordHasher;
    }

    public async Task<Response> HandleAsync(
        Command command,
        CancellationToken cancellationToken)
    {
        var name = command.Name?.Trim();
        var slug = command.Slug?.Trim().ToLowerInvariant();
        var email = command.AdministratorEmail?.Trim().ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(name) || name.Length > 200)
        {
            throw new ValidationException(
                "Hospital name is required and must be 200 characters or fewer.");
        }

        if (string.IsNullOrWhiteSpace(slug) || slug.Length > 100 ||
            !System.Text.RegularExpressions.Regex.IsMatch(
                slug,
                "^[a-z0-9]+(?:-[a-z0-9]+)*$"))
        {
            throw new ValidationException(
                "Hospital slug must contain 1-100 lowercase letters, numbers, or hyphens.");
        }

        if (string.IsNullOrWhiteSpace(email) || email.Length > 320 ||
            !MailAddress.TryCreate(email, out var parsedEmail) ||
            !string.Equals(parsedEmail.Address, email, StringComparison.OrdinalIgnoreCase))
        {
            throw new ValidationException("A valid administrator email is required.");
        }

        if (string.IsNullOrWhiteSpace(command.AdministratorPassword) ||
            command.AdministratorPassword.Length < 8 ||
            command.AdministratorPassword.Length > 128)
        {
            throw new ValidationException(
                "Administrator password must be between 8 and 128 characters.");
        }

        if (await _dbContext.Users.AnyAsync(x => x.Email == email, cancellationToken))
        {
            throw new ConflictException("An account with this email already exists.");
        }

        if (await _dbContext.Tenants.AnyAsync(x => x.Slug == slug, cancellationToken))
        {
            throw new ConflictException("A hospital with this slug already exists.");
        }

        var tenant = new Tenant(Guid.NewGuid(), name, slug);
        var user = new User(Guid.NewGuid(), email, string.Empty);
        user.SetPasswordHash(
            _passwordHasher.HashPassword(user, command.AdministratorPassword));
        var membership = new TenantMembership(
            Guid.NewGuid(),
            user.Id,
            tenant.Id,
            "admin");

        await using var transaction =
            await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            _dbContext.Tenants.Add(tenant);
            _dbContext.Users.Add(user);
            _dbContext.TenantMemberships.Add(membership);
            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsUniqueConstraintViolation(exception))
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ConflictException(
                "The hospital slug or administrator email is already registered.");
        }

        return new Response(tenant.Id, tenant.Name, tenant.Slug, user.Email);
    }

    private static bool IsUniqueConstraintViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation
        };
}

public sealed record Response(
    Guid TenantId,
    string Name,
    string Slug,
    string AdministratorEmail
);
