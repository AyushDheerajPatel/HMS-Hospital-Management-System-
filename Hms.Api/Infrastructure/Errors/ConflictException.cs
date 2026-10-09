namespace Hms.Api.Infrastructure.Errors;

public sealed class ConflictException : AppException
{
    public ConflictException(string message)
        : base(message)
    {
    }
}