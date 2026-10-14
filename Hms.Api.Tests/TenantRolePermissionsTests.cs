using Hms.Api.Infrastructure.Tenancy;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace Hms.Api.Tests;

public sealed class TenantRolePermissionsTests
{
    public static TheoryData<string, string, string, bool> RolePermissionCases => new()
    {
        { "admin", "POST", "/api/patients", true },
        { "doctor", "GET", "/api/patients", true },
        { "doctor", "POST", "/api/patients", false },
        { "receptionist", "POST", "/api/patients", true },
        { "staff", "GET", "/api/patients", true },
        { "staff", "DELETE", "/api/patients", false },
        { "doctor", "GET", "/api/patients/2d87346d-83f2-45fb-a73d-d10ad8ecfbc0/clinical-records", true },
        { "receptionist", "GET", "/api/patients/2d87346d-83f2-45fb-a73d-d10ad8ecfbc0/clinical-records", false },
        { "receptionist", "POST", "/api/patients/2d87346d-83f2-45fb-a73d-d10ad8ecfbc0/clinical-records", false },
        { "doctor", "PUT", "/api/patients/2d87346d-83f2-45fb-a73d-d10ad8ecfbc0/clinical-records/record-id", true },
        { "staff", "GET", "/api/appointments", true },
        { "doctor", "PATCH", "/api/appointments/2d87346d-83f2-45fb-a73d-d10ad8ecfbc0/status", true },
        { "receptionist", "PATCH", "/api/appointments/2d87346d-83f2-45fb-a73d-d10ad8ecfbc0/status", true },
        { "staff", "PATCH", "/api/appointments/2d87346d-83f2-45fb-a73d-d10ad8ecfbc0/status", false },
        { "doctor", "PUT", "/api/appointments/2d87346d-83f2-45fb-a73d-d10ad8ecfbc0", true },
        { "staff", "PUT", "/api/appointments/2d87346d-83f2-45fb-a73d-d10ad8ecfbc0", false },
        { "doctor", "POST", "/api/sync/appointments", true },
        { "receptionist", "POST", "/api/sync/appointments", true },
        { "staff", "POST", "/api/sync/appointments", false },
        { "doctor", "POST", "/api/appointments", true },
        { "receptionist", "POST", "/api/appointments", true },
        { "staff", "POST", "/api/appointments", false },
        { "unknown", "GET", "/api/patients", false },
        { "unknown", "GET", "/api/patients/2d87346d-83f2-45fb-a73d-d10ad8ecfbc0/clinical-records", false },
        { "staff", "GET", "/api/patients-admin", false },
        { "receptionist", "GET", "/api/appointments-secret", false },
        { "doctor", "GET", "/api/patients/2d87346d-83f2-45fb-a73d-d10ad8ecfbc0/clinical-records-export", false },
        { "admin", "POST", "/api/memberships", true },
        { "doctor", "POST", "/api/memberships", false }
    };

    [Theory]
    [MemberData(nameof(RolePermissionCases))]
    public void HasPermission_matches_role_and_exact_endpoint(
        string role,
        string method,
        string path,
        bool expected)
    {
        var allowed = TenantRolePermissions.HasPermission(
            role,
            method,
            new PathString(path));

        Assert.Equal(expected, allowed);
    }
}
