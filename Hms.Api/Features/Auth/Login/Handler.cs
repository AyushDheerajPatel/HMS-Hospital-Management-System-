using Hms.Api.Infrastructure.Auth;
using Hms.Api.Infrastructure.Errors;
using Hms.Domain.Users;
using Hms.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Hms.Api.Features.Auth.Login;

public sealed class Handler
{
    private readonly HmsDbContext _dbContext;
    private readonly IPasswordHasher<User> _passwordHasher;
    private readonly IJwtTokenService _jwtTokenService;

    public Handler(
        HmsDbContext dbContext,
        IPasswordHasher<User> passwordHasher,
        IJwtTokenService jwtTokenService)
    {
        _dbContext = dbContext;
        _passwordHasher = passwordHasher;
        _jwtTokenService = jwtTokenService;
    }

    public async Task<string> HandleAsync(Command command)
    {
        var email = command.Email?.Trim().ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(email))
        {
            throw new ValidationException("Email is required.");
        }

        if (string.IsNullOrWhiteSpace(command.Password))
        {
            throw new ValidationException("Password is required.");
        }

        var user = await _dbContext.Users
            .SingleOrDefaultAsync(x => x.Email == email);

        if (user is null)
        {
            throw new ValidationException(
                "Invalid email or password.");
        }

        var result = _passwordHasher.VerifyHashedPassword(
            user,
            user.PasswordHash,
            command.Password);

        if (result == PasswordVerificationResult.Failed)
        {
            throw new ValidationException(
                "Invalid email or password.");
        }

        return _jwtTokenService.CreateToken(user);
    }
}