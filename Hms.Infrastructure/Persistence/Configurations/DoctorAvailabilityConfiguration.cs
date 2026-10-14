using Hms.Domain.Appointments;
using Hms.Domain.Tenants;
using Hms.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Hms.Infrastructure.Persistence.Configurations;

public sealed class DoctorAvailabilityConfiguration
    : IEntityTypeConfiguration<DoctorAvailability>
{
    public void Configure(EntityTypeBuilder<DoctorAvailability> builder)
    {
        builder.ToTable("doctor_availabilities");

        builder.HasKey(x => new { x.TenantId, x.DoctorId, x.Date });

        builder.Property(x => x.Date)
            .HasColumnType("date");

        builder.Property(x => x.StartTimeUtc)
            .HasColumnType("time without time zone");

        builder.Property(x => x.EndTimeUtc)
            .HasColumnType("time without time zone");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(x => x.DoctorId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne<Tenant>()
            .WithMany()
            .HasForeignKey(x => x.TenantId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
