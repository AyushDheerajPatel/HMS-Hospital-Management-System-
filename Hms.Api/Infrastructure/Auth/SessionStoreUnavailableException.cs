namespace Hms.Api.Infrastructure.Auth;

public sealed class SessionStoreUnavailableException : Exception
{
    public SessionStoreUnavailableException(Exception innerException)
        : base("The active session store is unavailable.", innerException)
    {
    }
}
