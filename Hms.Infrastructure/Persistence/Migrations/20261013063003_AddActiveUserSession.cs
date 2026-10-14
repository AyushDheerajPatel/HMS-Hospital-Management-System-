using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Hms.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddActiveUserSession : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ActiveSessionId",
                table: "users",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ActiveSessionId",
                table: "users");
        }
    }
}
