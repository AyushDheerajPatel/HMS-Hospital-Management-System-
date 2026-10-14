using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hms.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAppointmentVersion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Version",
                table: "appointments",
                type: "integer",
                nullable: false,
                defaultValue: 1);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Version",
                table: "appointments");
        }
    }
}
