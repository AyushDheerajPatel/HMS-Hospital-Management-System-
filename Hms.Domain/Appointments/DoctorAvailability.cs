namespace Hms.Domain.Appointments;

public sealed class DoctorAvailability
{
    public Guid TenantId { get; private set; }

    public Guid DoctorId { get; private set; }

    public DateOnly Date { get; private set; }

    public TimeOnly StartTimeUtc { get; private set; }

    public TimeOnly EndTimeUtc { get; private set; }

    public DoctorAvailability(
        Guid tenantId,
        Guid doctorId,
        DateOnly date,
        TimeOnly startTimeUtc,
        TimeOnly endTimeUtc)
    {
        TenantId = tenantId;
        DoctorId = doctorId;
        Date = date;
        StartTimeUtc = startTimeUtc;
        EndTimeUtc = endTimeUtc;
    }

    public void SetWindow(TimeOnly startTimeUtc, TimeOnly endTimeUtc)
    {
        StartTimeUtc = startTimeUtc;
        EndTimeUtc = endTimeUtc;
    }
}
