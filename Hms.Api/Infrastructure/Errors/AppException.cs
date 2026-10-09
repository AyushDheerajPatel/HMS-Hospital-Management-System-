namespace Hms.Api.Infrastructure.Errors;

public abstract class AppException : Exception
{
    protected AppException(string message)
        : base(message)
    {
    }
}