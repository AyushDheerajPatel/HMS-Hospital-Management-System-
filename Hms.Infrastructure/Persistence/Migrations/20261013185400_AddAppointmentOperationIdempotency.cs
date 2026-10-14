using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hms.Infrastructure.Persistence.Migrations;

[DbContext(typeof(HmsDbContext))]
[Migration("20261013185400_AddAppointmentOperationIdempotency")]
public sealed class AddAppointmentOperationIdempotency : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "appointment_operations",
            columns: table => new
            {
                TenantId = table.Column<Guid>(
                    type: "uuid",
                    nullable: false),
                ClientOperationId = table.Column<Guid>(
                    type: "uuid",
                    nullable: false),
                AppointmentId = table.Column<Guid>(
                    type: "uuid",
                    nullable: false),
                PatientId = table.Column<Guid>(
                    type: "uuid",
                    nullable: false),
                ScheduledAtUtc = table.Column<DateTime>(
                    type: "timestamp with time zone",
                    nullable: false),
                Reason = table.Column<string>(
                    type: "character varying(500)",
                    maxLength: 500,
                    nullable: false),
                CreatedAtUtc = table.Column<DateTime>(
                    type: "timestamp with time zone",
                    nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey(
                    "PK_appointment_operations",
                    x => new { x.TenantId, x.ClientOperationId });
                table.ForeignKey(
                    name: "FK_appointment_operations_appointments_AppointmentId",
                    column: x => x.AppointmentId,
                    principalTable: "appointments",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_appointment_operations_AppointmentId",
            table: "appointment_operations",
            column: "AppointmentId",
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "appointment_operations");
    }
}
