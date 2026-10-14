using System.Net.Mail;
using System.Data;
using Hms.Api.Infrastructure.Errors;
using Hms.Api.Infrastructure.Tenancy;
using Hms.Domain.TenantMemberships;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Hms.Api.Features.Memberships;

public sealed class Handler
{
    private static readonly string[] AllowedRoles =
        ["admin", "doctor", "receptionist", "staff"];

    private readonly HmsDbContext _dbContext;
    private readonly ITenantContext _tenantContext;

    public Handler(HmsDbContext dbContext, ITenantContext tenantContext)
    {
        _dbContext = dbContext;
        _tenantContext = tenantContext;
    }

    public async Task<IReadOnlyList<MembershipItem>> ListAsync(
        CancellationToken cancellationToken)
    {
        var tenantId = GetTenantId();
        return await (
            from membership in _dbContext.TenantMemberships.AsNoTracking()
            join user in _dbContext.Users.AsNoTracking()
                on membership.UserId equals user.Id
            where membership.TenantId == tenantId
            orderby user.Email
            select new MembershipItem(
                membership.Id,
                user.Id,
                user.Email,
                membership.Role))
            .ToListAsync(cancellationToken);
    }

    public async Task<MembershipItem> AddAsync(
        Command command,
        CancellationToken cancellationToken)
    {
        var tenantId = GetTenantId();
        var email = command.Email?.Trim().ToLowerInvariant();
        var role = NormalizeRole(command.Role);
        if (string.IsNullOrWhiteSpace(email) ||
            email.Length > 320 ||
            !MailAddress.TryCreate(email, out var address) ||
            !string.Equals(address.Address, email, StringComparison.OrdinalIgnoreCase))
        {
            throw new ValidationException("A valid staff account email is required.");
        }

        if (role is null)
        {
            throw new ValidationException(
                "Role must be admin, doctor, receptionist, or staff.");
        }

        var user = await _dbContext.Users.SingleOrDefaultAsync(
            x => x.Email == email,
            cancellationToken);
        if (user is null)
        {
            throw new ValidationException(
                "No account exists for that email. The staff member must register an account first.");
        }

        if (await _dbContext.TenantMemberships.AnyAsync(
            x => x.UserId == user.Id && x.TenantId == tenantId,
            cancellationToken))
        {
            throw new ConflictException(
                "This user is already a member of the hospital.");
        }

        var membership = new TenantMembership(
            Guid.NewGuid(),
            user.Id,
            tenantId,
            role);
        _dbContext.TenantMemberships.Add(membership);
        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception)
            when (exception.InnerException is PostgresException
            {
                SqlState: PostgresErrorCodes.UniqueViolation
            })
        {
            _dbContext.Entry(membership).State = EntityState.Detached;
            throw new ConflictException(
                "This user is already a member of the hospital.");
        }

        return new MembershipItem(
            membership.Id,
            user.Id,
            user.Email,
            membership.Role);
    }

    public async Task<MembershipItem> ChangeRoleAsync(
        Guid membershipId,
        ChangeRoleCommand command,
        CancellationToken cancellationToken)
    {
        var tenantId = GetTenantId();
        var role = NormalizeRole(command.Role);
        if (role is null)
        {
            throw new ValidationException(
                "Role must be admin, doctor, receptionist, or staff.");
        }

        await using var transaction = await _dbContext.Database
            .BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        try
        {
            var membership = await _dbContext.TenantMemberships
                .SingleOrDefaultAsync(
                    item => item.Id == membershipId && item.TenantId == tenantId,
                    cancellationToken)
                ?? throw new ValidationException("Hospital membership not found.");

            if (membership.Role.Equals("admin", StringComparison.OrdinalIgnoreCase) &&
                role != "admin" &&
                await CountAdminsAsync(tenantId, cancellationToken) <= 1)
            {
                throw new ConflictException(
                    "The hospital must retain at least one administrator.");
            }

            var user = await _dbContext.Users.SingleAsync(
                item => item.Id == membership.UserId,
                cancellationToken);
            _dbContext.Entry(membership).Property(item => item.Role).CurrentValue = role;
            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new MembershipItem(
                membership.Id,
                user.Id,
                user.Email,
                role);
        }
        catch (DbUpdateException exception)
            when (exception.InnerException is PostgresException
            {
                SqlState: PostgresErrorCodes.SerializationFailure
            })
        {
            throw new ConflictException(
                "Hospital roles changed concurrently. Reload the staff list and try again.");
        }
        catch (PostgresException exception)
            when (exception.SqlState == PostgresErrorCodes.SerializationFailure)
        {
            throw new ConflictException(
                "Hospital roles changed concurrently. Reload the staff list and try again.");
        }
    }

    public async Task RemoveAsync(
        Guid membershipId,
        CancellationToken cancellationToken)
    {
        var tenantId = GetTenantId();
        await using var transaction = await _dbContext.Database
            .BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        try
        {
            var membership = await _dbContext.TenantMemberships
                .SingleOrDefaultAsync(
                    item => item.Id == membershipId && item.TenantId == tenantId,
                    cancellationToken)
                ?? throw new ValidationException("Hospital membership not found.");

            if (membership.Role.Equals("admin", StringComparison.OrdinalIgnoreCase) &&
                await CountAdminsAsync(tenantId, cancellationToken) <= 1)
            {
                throw new ConflictException(
                    "The hospital must retain at least one administrator.");
            }

            _dbContext.TenantMemberships.Remove(membership);
            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception)
            when (exception.InnerException is PostgresException
            {
                SqlState: PostgresErrorCodes.SerializationFailure
            })
        {
            throw new ConflictException(
                "Hospital roles changed concurrently. Reload the staff list and try again.");
        }
        catch (PostgresException exception)
            when (exception.SqlState == PostgresErrorCodes.SerializationFailure)
        {
            throw new ConflictException(
                "Hospital roles changed concurrently. Reload the staff list and try again.");
        }
    }

    private Guid GetTenantId() =>
        _tenantContext.TenantId
        ?? throw new ValidationException("Tenant context is required.");

    private Task<int> CountAdminsAsync(
        Guid tenantId,
        CancellationToken cancellationToken) =>
        _dbContext.TenantMemberships.CountAsync(
            item => item.TenantId == tenantId &&
                    item.Role.ToLower() == "admin",
            cancellationToken);

    private static string? NormalizeRole(string? role)
    {
        var normalized = role?.Trim().ToLowerInvariant();
        return normalized is not null && AllowedRoles.Contains(normalized)
            ? normalized
            : null;
    }
}

public sealed record MembershipItem(
    Guid MembershipId,
    Guid UserId,
    string Email,
    string Role
);
