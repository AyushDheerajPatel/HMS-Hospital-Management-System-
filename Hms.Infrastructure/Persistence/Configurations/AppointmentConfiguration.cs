using Hms.Domain.Appointments;
using Hms.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Hms.Infrastructure.Persistence.Configurations;

public sealed class AppointmentConfiguration
    : IEntityTypeConfiguration<Appointment>
{
    public void Configure(
        EntityTypeBuilder<Appointment> builder)
    {
        builder.ToTable("appointments");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Reason)
            .HasMaxLength(500)
            .IsRequired();

        builder.Property(x => x.Status)
            .HasMaxLength(30)
            .IsRequired();

        builder.Property(x => x.ScheduledAtUtc)
            .IsRequired();

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(x => x.DoctorId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(x => x.CreatedAtUtc)
            .IsRequired();

        builder.Property(x => x.Version)
            .HasDefaultValue(1)
            .IsConcurrencyToken()
            .IsRequired();

        builder.HasIndex(x => x.TenantId);

        builder.HasIndex(x => new
        {
            x.TenantId,
            x.ScheduledAtUtc
        });

        builder.HasIndex(x => new
        {
            x.TenantId,
            x.DoctorId,
            x.ScheduledAtUtc
        });

        builder.HasIndex(x => new
        {
            x.TenantId,
            x.PatientId
        });

    }
}