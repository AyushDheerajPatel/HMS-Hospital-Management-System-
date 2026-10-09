namespace Hms.Api.Infrastructure.Errors;

public sealed class ValidationException : AppException
{
    public ValidationException(string message)
        : base(message)
    {
    }
}