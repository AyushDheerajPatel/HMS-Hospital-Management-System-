using Hms.Domain.Appointments;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Hms.Infrastructure.Persistence.Configurations;

public sealed class AppointmentOperationConfiguration
    : IEntityTypeConfiguration<AppointmentOperation>
{
    public void Configure(EntityTypeBuilder<AppointmentOperation> builder)
    {
        builder.ToTable("appointment_operations");

        builder.HasKey(x => new { x.TenantId, x.ClientOperationId });

        builder.Property(x => x.Reason)
            .HasMaxLength(500)
            .IsRequired();

        builder.Property(x => x.ScheduledAtUtc)
            .IsRequired();

        builder.Property(x => x.CreatedAtUtc)
            .IsRequired();

        builder.HasIndex(x => x.AppointmentId)
            .IsUnique();

        builder.HasOne<Appointment>()
            .WithMany()
            .HasForeignKey(x => x.AppointmentId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
