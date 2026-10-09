using Hms.Domain.Users;

namespace Hms.Api.Infrastructure.Auth;

public interface IJwtTokenService
{
    string CreateToken(User user);
}