using Hms.Api.Features.Appointments;
using Hms.Api.Features.Appointments.CreateAppointment;
using Hms.Api.Features.Dashboard;
using Hms.Api.Infrastructure.Errors;
using Hms.Api.Infrastructure.Tenancy;
using Hms.Domain.Patients;
using Hms.Domain.Appointments;
using Hms.Domain.TenantMemberships;
using Hms.Domain.Tenants;
using Hms.Domain.Users;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Xunit;
using AppointmentCreationHandler =
    Hms.Api.Features.Appointments.CreateAppointment.Handler;

namespace Hms.Api.Tests;

public sealed class PostgresAppointmentIdempotencyTests
{
    [PostgresFact]
    public async Task PostgreSql_concurrent_retries_create_one_appointment_and_scope_keys_by_tenant()
    {
        var configuredConnectionString =
            Environment.GetEnvironmentVariable("HMS_TEST_POSTGRES_CONNECTION");

        var schema = $"hms_test_{Guid.NewGuid():N}";
        var baseConnection = new NpgsqlConnectionStringBuilder(
            configuredConnectionString);
        await using var adminConnection = new NpgsqlConnection(
            baseConnection.ConnectionString);
        await adminConnection.OpenAsync();
        await using (var createSchema = adminConnection.CreateCommand())
        {
            createSchema.CommandText = $"CREATE SCHEMA \"{schema}\"";
            await createSchema.ExecuteNonQueryAsync();
        }

        try
        {
            var isolatedConnection = new NpgsqlConnectionStringBuilder(
                baseConnection.ConnectionString)
            {
                SearchPath = schema
            }.ConnectionString;
            var options = new DbContextOptionsBuilder<HmsDbContext>()
                .UseNpgsql(isolatedConnection)
                .Options;

            var firstTenantId = Guid.NewGuid();
            var secondTenantId = Guid.NewGuid();
            var firstPatientId = Guid.NewGuid();
            var secondPatientId = Guid.NewGuid();
            var firstDoctorId = Guid.NewGuid();
            var secondDoctorId = Guid.NewGuid();
            var anotherFirstTenantDoctorId = Guid.NewGuid();
            await using (var seedContext = new HmsDbContext(options))
            {
                await seedContext.Database.MigrateAsync();
                seedContext.Tenants.AddRange(
                    new Tenant(firstTenantId, "First test hospital", "first-test"),
                    new Tenant(secondTenantId, "Second test hospital", "second-test"));
                seedContext.Patients.AddRange(
                    CreatePatient(firstPatientId, firstTenantId),
                    CreatePatient(secondPatientId, secondTenantId));
                seedContext.Users.AddRange(
                    new User(firstDoctorId, "first-doctor@example.invalid", "unused"),
                    new User(secondDoctorId, "second-doctor@example.invalid", "unused"),
                    new User(
                        anotherFirstTenantDoctorId,
                        "another-doctor@example.invalid",
                        "unused"));
                seedContext.TenantMemberships.AddRange(
                    new TenantMembership(
                        Guid.NewGuid(),
                        firstDoctorId,
                        firstTenantId,
                        "doctor"),
                    new TenantMembership(
                        Guid.NewGuid(),
                        secondDoctorId,
                        secondTenantId,
                        "doctor"),
                    new TenantMembership(
                        Guid.NewGuid(),
                        anotherFirstTenantDoctorId,
                        firstTenantId,
                        "doctor"));
                var scheduledDate = DateOnly.FromDateTime(
                    DateTime.UtcNow.AddDays(2));
                seedContext.DoctorAvailabilities.AddRange(
                    new DoctorAvailability(
                        firstTenantId,
                        firstDoctorId,
                        scheduledDate,
                        new TimeOnly(10, 0),
                        new TimeOnly(12, 0)),
                    new DoctorAvailability(
                        secondTenantId,
                        secondDoctorId,
                        scheduledDate,
                        new TimeOnly(10, 0),
                        new TimeOnly(12, 0)),
                    new DoctorAvailability(
                        firstTenantId,
                        anotherFirstTenantDoctorId,
                        scheduledDate,
                        new TimeOnly(10, 0),
                        new TimeOnly(12, 0)));
                await seedContext.SaveChangesAsync();
            }

            var operationId = Guid.NewGuid();
            var scheduledAtUtc = DateTime.UtcNow.Date
                .AddDays(2)
                .AddHours(10);
            var command = new Command(
                firstPatientId,
                firstDoctorId,
                scheduledAtUtc,
                "Offline follow-up",
                operationId);
            var results = await Task.WhenAll(
                Enumerable.Range(0, 8)
                    .Select(_ => InvokeHandlerAsync(
                        options,
                        firstTenantId,
                        command)));

            Assert.Single(results.Select(result => result.Id).Distinct());
            Assert.Single(results.Select(result => result.CreatedAtUtc).Distinct());
            Assert.Equal(firstDoctorId, results[0].DoctorId);

            await using (var slotsContext = new HmsDbContext(options))
            {
                var tenantContext = new TenantContext();
                tenantContext.SetTenant(firstTenantId);
                var schedulingHandler = new Hms.Api.Features.Appointments
                    .DoctorScheduling.Handler(
                        slotsContext,
                        tenantContext,
                        new TestCurrentUser(firstDoctorId));
                var slots = await schedulingHandler.GetSlotsAsync(
                    firstDoctorId,
                    DateOnly.FromDateTime(scheduledAtUtc),
                    default);
                Assert.DoesNotContain(scheduledAtUtc, slots);
                Assert.Contains(scheduledAtUtc.AddMinutes(30), slots);
            }
            var replayedResult = await InvokeHandlerAsync(
                options,
                firstTenantId,
                command);
            Assert.Equal(results[0], replayedResult);
            await using (var verifyContext = new HmsDbContext(options))
            {
                Assert.Equal(
                    1,
                    await verifyContext.AppointmentOperations.CountAsync(
                        appointment =>
                            appointment.TenantId == firstTenantId &&
                            appointment.ClientOperationId == operationId));
            }

            var sameKeyInOtherTenant = await InvokeHandlerAsync(
                options,
                secondTenantId,
                command with
                {
                    PatientId = secondPatientId,
                    DoctorId = secondDoctorId
                });
            Assert.NotEqual(results[0].Id, sameKeyInOtherTenant.Id);
            Assert.Equal(firstTenantId, results[0].TenantId);
            Assert.Equal(secondTenantId, sameKeyInOtherTenant.TenantId);

            var differentDoctorBooking = await InvokeHandlerAsync(
                options,
                firstTenantId,
                command with
                {
                    DoctorId = anotherFirstTenantDoctorId,
                    ClientOperationId = Guid.NewGuid()
                });
            Assert.Equal(
                anotherFirstTenantDoctorId,
                differentDoctorBooking.DoctorId);

            await using (var verifyContext = new HmsDbContext(options))
            {
                Assert.Equal(3, await verifyContext.Appointments.CountAsync());
            }

            await Assert.ThrowsAsync<ConflictException>(() =>
                InvokeHandlerAsync(
                    options,
                    firstTenantId,
                    command with { Reason = "Different payload" }));

            await Assert.ThrowsAsync<ConflictException>(() =>
            InvokeHandlerAsync(
                options,
                firstTenantId,
                command with { ClientOperationId = Guid.NewGuid() }));

            var concurrentSlot = command with
            {
            ScheduledAtUtc = scheduledAtUtc.AddHours(1),
            ClientOperationId = Guid.NewGuid()
            };
            var concurrentResults = await Task.WhenAll(
            Enumerable.Range(0, 2).Select(async _ =>
            {
                try
                {
                    return (Result: await InvokeHandlerAsync(
                        options,
                        firstTenantId,
                        concurrentSlot with
                        {
                            ClientOperationId = Guid.NewGuid()
                        }), Conflict: false);
                }
                catch (ConflictException)
                {
                    return (Result: (AppointmentResult?)null, Conflict: true);
                }
            }));
            Assert.Single(
                concurrentResults,
                result => result.Result is not null);
            Assert.Single(
                concurrentResults,
                result => result.Conflict);

            await CancelAppointmentAsync(
            options,
            firstTenantId,
            results[0].Id);
            await using (var slotsContext = new HmsDbContext(options))
            {
            var tenantContext = new TenantContext();
            tenantContext.SetTenant(firstTenantId);
            var schedulingHandler = new Hms.Api.Features.Appointments
                .DoctorScheduling.Handler(
                    slotsContext,
                    tenantContext,
                    new TestCurrentUser(firstDoctorId));
            var slots = await schedulingHandler.GetSlotsAsync(
                firstDoctorId,
                DateOnly.FromDateTime(scheduledAtUtc),
                default);
            Assert.Contains(scheduledAtUtc, slots);
            }
            var replacement = await InvokeHandlerAsync(
            options,
            firstTenantId,
            command with { ClientOperationId = Guid.NewGuid() });
            Assert.Equal(firstDoctorId, replacement.DoctorId);
        }
        finally
        {
            await using var dropSchema = adminConnection.CreateCommand();
            dropSchema.CommandText = $"DROP SCHEMA IF EXISTS \"{schema}\" CASCADE";
            await dropSchema.ExecuteNonQueryAsync();
        }
    }

    [AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
    internal sealed class PostgresFactAttribute : FactAttribute
    {
        public PostgresFactAttribute()
        {
            if (string.IsNullOrWhiteSpace(
                    Environment.GetEnvironmentVariable("HMS_TEST_POSTGRES_CONNECTION")))
            {
                Skip = "Set HMS_TEST_POSTGRES_CONNECTION to run PostgreSQL integration tests.";
            }
        }
    }

    private static async Task CancelAppointmentAsync(
        DbContextOptions<HmsDbContext> options,
        Guid tenantId,
        Guid appointmentId)
    {
        await using var dbContext = new HmsDbContext(options);
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(tenantId);
        var appointment = await dbContext.Appointments
            .SingleAsync(item => item.Id == appointmentId);
        var handler = new Hms.Api.Features.Appointments.ChangeAppointmentStatus.Handler(
            dbContext,
            tenantContext,
            new DashboardStatsCache(
                Array.Empty<Microsoft.Extensions.Caching.Distributed.IDistributedCache>(),
                NullLogger<DashboardStatsCache>.Instance),
            new AppointmentUpdates());
        await handler.HandleAsync(
            appointmentId,
            new Hms.Api.Features.Appointments.ChangeAppointmentStatus.Command(
                "cancelled",
                appointment.Version),
            default);
    }

    private static async Task<AppointmentResult> InvokeHandlerAsync(
        DbContextOptions<HmsDbContext> options,
        Guid tenantId,
        Command command)
    {
        await using var dbContext = new HmsDbContext(options);
        var tenantContext = new TenantContext();
        tenantContext.SetTenant(tenantId);
        var handler = new AppointmentCreationHandler(
            dbContext,
            tenantContext,
            new DashboardStatsCache(
                Array.Empty<Microsoft.Extensions.Caching.Distributed.IDistributedCache>(),
                NullLogger<DashboardStatsCache>.Instance),
            new AppointmentUpdates());
        return await handler.HandleAsync(command);
    }

    private static Patient CreatePatient(Guid patientId, Guid tenantId) =>
        new(
            patientId,
            tenantId,
            "Integration",
            "Test",
            new DateOnly(1980, 1, 1),
            null,
            null);

    private sealed class TestCurrentUser(Guid? userId)
        : Hms.Api.Infrastructure.Auth.ICurrentUser
    {
        public Guid? UserId { get; } = userId;
    }
}
