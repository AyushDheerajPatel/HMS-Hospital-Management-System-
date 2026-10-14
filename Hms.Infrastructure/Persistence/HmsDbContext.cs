using Hms.Domain.TenantMemberships;
using Hms.Domain.Tenants;
using Hms.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Hms.Domain.Patients;
using Hms.Domain.Appointments;

namespace Hms.Infrastructure.Persistence;

public sealed class HmsDbContext : DbContext
{
    public HmsDbContext(DbContextOptions<HmsDbContext> options)
        : base(options)
    {
    }

    public DbSet<User> Users => Set<User>();


    public DbSet<TenantMembership> TenantMemberships =>
        Set<TenantMembership>();

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<Patient> Patients => Set<Patient>();
    public DbSet<Appointment> Appointments =>
    Set<Appointment>();

    public DbSet<AppointmentOperation> AppointmentOperations =>
        Set<AppointmentOperation>();

    public DbSet<DoctorAvailability> DoctorAvailabilities =>
        Set<DoctorAvailability>();

    protected override void OnModelCreating(
        ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(
            typeof(HmsDbContext).Assembly);
    }
}