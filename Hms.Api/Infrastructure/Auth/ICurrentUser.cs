namespace Hms.Api.Infrastructure.Auth;

public interface ICurrentUser
{
    Guid? UserId { get; }
}