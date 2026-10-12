using Hms.Domain.Users;

namespace Hms.Api.Features.Auth;

public interface IJwtTokenService
{
    string CreateToken(User user);
}