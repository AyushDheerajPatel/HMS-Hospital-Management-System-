  using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Hms.Api.Infrastructure.Auth;
using Hms.Api.Features.Auth.Logout;
using Hms.Domain.Users;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;
using Xunit;

namespace Hms.Api.Tests;

public sealed class ActiveSessionTests
{
    [Fact]
    public async Task Redis_replacement_rejects_old_tokens_and_logout_is_session_scoped()
    {
        var options = ConfigurationOptions.Parse(
            Environment.GetEnvironmentVariable("HMS_TEST_REDIS_CONFIGURATION")
                ?? "127.0.0.1:6379");
        options.AbortOnConnectFail = false;
        options.ConnectTimeout = 2000;
        options.AsyncTimeout = 2000;
        options.SyncTimeout = 2000;
        options.ConnectRetry = 1;

        using var multiplexer = await ConnectionMultiplexer.ConnectAsync(options);
        var store = new RedisActiveSessionStore(multiplexer);
        var userId = Guid.NewGuid();
        var firstSessionId = Guid.NewGuid();
        var secondSessionId = Guid.NewGuid();
        const string jwtKey = "active-session-test-signing-key-0123456789";
        const string jwtIssuer = "Hms.Api.Tests";
        const string jwtAudience = "Hms.Api.Tests.Client";
        var jwtTokenService = new JwtTokenService(
            new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Jwt:Key"] = jwtKey,
                    ["Jwt:Issuer"] = jwtIssuer,
                    ["Jwt:Audience"] = jwtAudience
                })
                .Build());
        var user = new User(userId, "session-test@example.invalid", "unused");
        var firstToken = jwtTokenService.CreateToken(user, firstSessionId);
        var secondToken = jwtTokenService.CreateToken(user, secondSessionId);

        await store.ActivateAsync(userId, firstSessionId, default);
        Assert.True(await store.IsActiveAsync(userId, firstSessionId, default));

        var key = $"hms:auth:active-session:{userId:N}";
        var ttl = await multiplexer.GetDatabase().KeyTimeToLiveAsync(key);
        Assert.NotNull(ttl);
        Assert.InRange(
            ttl!.Value,
            TimeSpan.FromMilliseconds(1),
            ActiveSessionConstants.AccessTokenLifetime);

        var middleware = new ActiveSessionMiddleware(
            _ => Task.CompletedTask,
            NullLogger<ActiveSessionMiddleware>.Instance);
        var firstRequest = CreateRequestFromToken(
            firstToken,
            jwtKey,
            jwtIssuer,
            jwtAudience);
        await middleware.InvokeAsync(firstRequest, store);
        Assert.Equal(StatusCodes.Status200OK, firstRequest.Response.StatusCode);

        await store.ActivateAsync(userId, secondSessionId, default);
        var revokedRequest = CreateRequestFromToken(
            firstToken,
            jwtKey,
            jwtIssuer,
            jwtAudience);
        await middleware.InvokeAsync(revokedRequest, store);
        Assert.Equal(
            StatusCodes.Status401Unauthorized,
            revokedRequest.Response.StatusCode);

        var currentRequest = CreateRequestFromToken(
            secondToken,
            jwtKey,
            jwtIssuer,
            jwtAudience);
        await middleware.InvokeAsync(currentRequest, store);
        Assert.Equal(StatusCodes.Status200OK, currentRequest.Response.StatusCode);

        var logoutHandler = new Handler(store);
        await logoutHandler.HandleAsync(userId, firstSessionId, default);
        Assert.True(await store.IsActiveAsync(userId, secondSessionId, default));

        await logoutHandler.HandleAllDevicesAsync(
            userId,
            secondSessionId,
            default);
        await logoutHandler.HandleAllDevicesAsync(
            userId,
            secondSessionId,
            default);
        Assert.False(await store.IsActiveAsync(userId, secondSessionId, default));
        var loggedOutRequest = CreateRequestFromToken(
            secondToken,
            jwtKey,
            jwtIssuer,
            jwtAudience);
        await middleware.InvokeAsync(loggedOutRequest, store);
        Assert.Equal(
            StatusCodes.Status401Unauthorized,
            loggedOutRequest.Response.StatusCode);

        var anotherUserId = Guid.NewGuid();
        var anotherUserSessionId = Guid.NewGuid();
        await store.ActivateAsync(anotherUserId, anotherUserSessionId, default);
        await store.RevokeAsync(userId, anotherUserSessionId, default);
        Assert.True(
            await store.IsActiveAsync(
                anotherUserId,
                anotherUserSessionId,
                default));
        await store.RevokeAsync(
            anotherUserId,
            anotherUserSessionId,
            default);

        await store.RevokeAsync(userId, Guid.NewGuid(), default);
        Assert.False(await store.IsActiveAsync(userId, secondSessionId, default));
    }

    [Fact]
    public async Task Invalid_session_claim_is_rejected_and_redis_failure_fails_closed()
    {
        var middleware = new ActiveSessionMiddleware(
            _ => Task.CompletedTask,
            NullLogger<ActiveSessionMiddleware>.Instance);
        var store = new UnavailableSessionStore();

        var malformedRequest = CreateAuthenticatedRequest(
            Guid.NewGuid(),
            Guid.Empty,
            "not-a-guid");
        await middleware.InvokeAsync(malformedRequest, store);
        Assert.Equal(
            StatusCodes.Status401Unauthorized,
            malformedRequest.Response.StatusCode);
        Assert.Equal(0, store.ValidationCalls);

        var emptySessionRequest = CreateAuthenticatedRequest(
            Guid.NewGuid(),
            Guid.Empty);
        await middleware.InvokeAsync(emptySessionRequest, store);
        Assert.Equal(
            StatusCodes.Status401Unauthorized,
            emptySessionRequest.Response.StatusCode);
        Assert.Equal(0, store.ValidationCalls);

        var validRequest = CreateAuthenticatedRequest(
            Guid.NewGuid(),
            Guid.NewGuid());
        await middleware.InvokeAsync(validRequest, store);
        Assert.Equal(
            StatusCodes.Status503ServiceUnavailable,
            validRequest.Response.StatusCode);
        Assert.Equal("5", validRequest.Response.Headers.RetryAfter);
    }

    [Fact]
    public void Expired_access_token_is_rejected_by_jwt_validation()
    {
        const string jwtKey = "active-session-test-signing-key-0123456789";
        const string jwtIssuer = "Hms.Api.Tests";
        const string jwtAudience = "Hms.Api.Tests.Client";
        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));
        var credentials = new SigningCredentials(
            signingKey,
            SecurityAlgorithms.HmacSha256);
        var expiredToken = new JwtSecurityToken(
            jwtIssuer,
            jwtAudience,
            [new Claim(JwtRegisteredClaimNames.Sub, Guid.NewGuid().ToString())],
            expires: DateTime.UtcNow.AddMinutes(-1),
            signingCredentials: credentials);
        var serializedToken = new JwtSecurityTokenHandler()
            .WriteToken(expiredToken);

        Assert.Throws<SecurityTokenExpiredException>(() =>
            new JwtSecurityTokenHandler().ValidateToken(
                serializedToken,
                CreateValidationParameters(jwtKey, jwtIssuer, jwtAudience),
                out _));
    }

    [Fact]
    public async Task Health_endpoint_does_not_depend_on_redis_session_state()
    {
        var nextCalled = false;
        var middleware = new ActiveSessionMiddleware(
            _ =>
            {
                nextCalled = true;
                return Task.CompletedTask;
            },
            NullLogger<ActiveSessionMiddleware>.Instance);
        var context = CreateAuthenticatedRequest(Guid.NewGuid(), Guid.NewGuid());
        context.Request.Path = "/api/health";

        await middleware.InvokeAsync(context, new UnavailableSessionStore());

        Assert.True(nextCalled);
        Assert.Equal(StatusCodes.Status200OK, context.Response.StatusCode);
    }

    private static DefaultHttpContext CreateAuthenticatedRequest(
        Guid userId,
        Guid sessionId,
        string? sessionClaim = null)
    {
        var context = new DefaultHttpContext();
        context.Request.Path = "/api/patients";
        context.User = new ClaimsPrincipal(
            new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                new Claim("sid", sessionClaim ?? sessionId.ToString())
            ],
            "Bearer"));
        return context;
    }

    private static DefaultHttpContext CreateRequestFromToken(
        string accessToken,
        string jwtKey,
        string jwtIssuer,
        string jwtAudience)
    {
        var principal = new JwtSecurityTokenHandler().ValidateToken(
            accessToken,
            CreateValidationParameters(jwtKey, jwtIssuer, jwtAudience),
            out _);
        var context = new DefaultHttpContext
        {
            User = principal
        };
        context.Request.Path = "/api/patients";
        return context;
    }

    private static TokenValidationParameters CreateValidationParameters(
        string jwtKey,
        string jwtIssuer,
        string jwtAudience) =>
        new()
        {
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = true,
            ValidAudience = jwtAudience,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.Zero,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(jwtKey))
        };

    private sealed class UnavailableSessionStore : IActiveSessionStore
    {
        public int ValidationCalls { get; private set; }

        public Task ActivateAsync(
            Guid userId,
            Guid sessionId,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<bool> IsActiveAsync(
            Guid userId,
            Guid sessionId,
            CancellationToken cancellationToken)
        {
            ValidationCalls++;
            throw new SessionStoreUnavailableException(
                new RedisConnectionException(
                    ConnectionFailureType.UnableToConnect,
                    "Unavailable for test."));
        }

        public Task RevokeAsync(
            Guid userId,
            Guid sessionId,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }
}
