using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hms.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDoctorAppointmentScheduling : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "DoctorId",
                table: "appointments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DoctorId",
                table: "appointment_operations",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "doctor_availabilities",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    DoctorId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    StartTimeUtc = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    EndTimeUtc = table.Column<TimeOnly>(type: "time without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_doctor_availabilities", x => new { x.TenantId, x.DoctorId, x.Date });
                    table.ForeignKey(
                        name: "FK_doctor_availabilities_tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_doctor_availabilities_users_DoctorId",
                        column: x => x.DoctorId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_appointments_DoctorId",
                table: "appointments",
                column: "DoctorId");

            migrationBuilder.CreateIndex(
                name: "IX_appointments_TenantId_DoctorId_ScheduledAtUtc",
                table: "appointments",
                columns: new[] { "TenantId", "DoctorId", "ScheduledAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_doctor_availabilities_DoctorId",
                table: "doctor_availabilities",
                column: "DoctorId");

            migrationBuilder.AddForeignKey(
                name: "FK_appointments_users_DoctorId",
                table: "appointments",
                column: "DoctorId",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_appointments_users_DoctorId",
                table: "appointments");

            migrationBuilder.DropTable(
                name: "doctor_availabilities");

            migrationBuilder.DropIndex(
                name: "IX_appointments_DoctorId",
                table: "appointments");

            migrationBuilder.DropIndex(
                name: "IX_appointments_TenantId_DoctorId_ScheduledAtUtc",
                table: "appointments");

            migrationBuilder.DropColumn(
                name: "DoctorId",
                table: "appointments");

            migrationBuilder.DropColumn(
                name: "DoctorId",
                table: "appointment_operations");
        }
    }
}
