namespace Hms.Domain.Patients;

public sealed class Patient
{
    public Guid Id { get; private set; }
    public Guid TenantId { get; private set; }

    public string FirstName { get; private set; }
    public string LastName { get; private set; }

    public DateOnly DateOfBirth { get; private set; }

    public string? Phone { get; private set; }
    public string? Email { get; private set; }

    public string Status { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }

    public Patient(
        Guid id,
        Guid tenantId,
        string firstName,
        string lastName,
        DateOnly dateOfBirth,
        string? phone,
        string? email)
    {
        Id = id;
        TenantId = tenantId;
        FirstName = firstName;
        LastName = lastName;
        DateOfBirth = dateOfBirth;
        Phone = phone;
        Email = email;
        Status = "active";
        CreatedAtUtc = DateTime.UtcNow;
    }
}