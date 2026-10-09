using Hms.Api.Infrastructure.Errors;
using Hms.Domain.Users;
using Hms.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Hms.Api.Features.Auth.Register;

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

    public async Task<User> HandleAsync(Command command)
    {
        var email = command.Email.Trim().ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(email))
        {
            throw new ValidationException("Email is required.");
        }

        if (string.IsNullOrWhiteSpace(command.Password))
        {
            throw new ValidationException("Password is required.");
        }

        if (command.Password.Length < 8)
        {
            throw new ValidationException(
                "Password must be at least 8 characters.");
        }

        var exists = await _dbContext.Users
            .AnyAsync(x => x.Email == email);

        if (exists)
        {
            throw new ConflictException(
                $"User with email '{email}' already exists.");
        }

        var user = new User(
            Guid.NewGuid(),
            email,
            string.Empty);

        user.SetPasswordHash(
            _passwordHasher.HashPassword(
                user,
                command.Password));

        _dbContext.Users.Add(user);

        await _dbContext.SaveChangesAsync();

        return user;
    }
}