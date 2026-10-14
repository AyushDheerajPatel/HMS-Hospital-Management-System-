namespace Hms.Domain.Users;

public sealed class User
{
    public Guid Id { get; private set; }

    public string Email { get; private set; }

    public string PasswordHash { get; private set; }

    public Guid? ActiveSessionId { get; private set; }

    public User(
        Guid id,
        string email,
        string passwordHash)
    {
        Id = id;
        Email = email;
        PasswordHash = passwordHash;
    }

    public void SetPasswordHash(string passwordHash)
    {
        PasswordHash = passwordHash;
    }

    public void StartSession(Guid sessionId)
    {
        ActiveSessionId = sessionId;
    }

    public bool EndSession(Guid sessionId)
    {
        if (ActiveSessionId != sessionId)
        {
            return false;
        }

        ActiveSessionId = null;
        return true;
    }
}