using Microsoft.IdentityModel.Tokens;
using System.Text;
using Hms.Api.Features.Health;
using Hms.Api.Infrastructure.Auth;
using Hms.Api.Infrastructure.Tenancy;
using Hms.Api.Infrastructure.ExceptionHandling;
using Hms.Api.Features.Realtime;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using System.Security.Claims;
using Hms.Domain.Users;
using Hms.Infrastructure.MongoDB;
using StackExchange.Redis;
using CreateClinicalRecord = Hms.Api.Features.ClinicalRecords.CreateClinicalRecord;
using ListClinicalRecords = Hms.Api.Features.ClinicalRecords.ListClinicalRecords;
using UpdateClinicalRecord = Hms.Api.Features.ClinicalRecords.UpdateClinicalRecord;
using DeleteClinicalRecord = Hms.Api.Features.ClinicalRecords.DeleteClinicalRecord;

using CreateTenant = Hms.Api.Features.Tenants.CreateTenant;
using RegisterTenant = Hms.Api.Features.Tenants.RegisterTenant;
using Register = Hms.Api.Features.Auth.Register;
using Login = Hms.Api.Features.Auth.Login;
using CreatePatient = Hms.Api.Features.Patients.CreatePatient;
using GetPatient = Hms.Api.Features.Patients.GetPatient;
using ListPatients = Hms.Api.Features.Patients.ListPatients;
using CreateAppointment = Hms.Api.Features.Appointments.CreateAppointment;
using RescheduleAppointment = Hms.Api.Features.Appointments.RescheduleAppointment;
using UpdateAppointment = Hms.Api.Features.Appointments.UpdateAppointment;
using ChangeAppointmentStatus = Hms.Api.Features.Appointments.ChangeAppointmentStatus;
using DoctorScheduling = Hms.Api.Features.Appointments.DoctorScheduling;
using ListAppointments = Hms.Api.Features.Appointments.ListAppointments;
using Dashboard = Hms.Api.Features.Dashboard;
using Memberships = Hms.Api.Features.Memberships;
using SyncAppointments = Hms.Api.Features.Sync.SyncAppointments;

var builder = WebApplication.CreateBuilder(args);
var jwtKey = builder.Configuration["Jwt:Key"]
    ?? throw new InvalidOperationException("JWT signing key is not configured.");
if (Encoding.UTF8.GetByteCount(jwtKey) < 32)
{
    throw new InvalidOperationException(
        "JWT signing key must be at least 32 bytes.");
}
var jwtIssuer = builder.Configuration["Jwt:Issuer"]
    ?? throw new InvalidOperationException("JWT issuer is not configured.");
var jwtAudience = builder.Configuration["Jwt:Audience"]
    ?? throw new InvalidOperationException("JWT audience is not configured.");

builder.Services.AddScoped<CreateClinicalRecord.Handler>();
builder.Services.AddScoped<ListClinicalRecords.Handler>();
builder.Services.AddScoped<UpdateClinicalRecord.Handler>();
builder.Services.AddScoped<DeleteClinicalRecord.Handler>();
builder.Services.AddSingleton<MongoDbContext>();
builder.Services.AddProblemDetails();
builder.Services.AddScoped<Login.Handler>();
builder.Services.AddScoped<Hms.Api.Features.Auth.Logout.Handler>();
builder.Services.AddSingleton<IActiveSessionStore, RedisActiveSessionStore>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();
builder.Services.AddScoped<Hms.Api.Features.Auth.IJwtTokenService>(
    services => services.GetRequiredService<IJwtTokenService>());
builder.Services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddScoped<Register.Handler>();
builder.Services.AddScoped<ITenantContext, TenantContext>();
builder.Services.AddSingleton<HospitalRealtimePublisher>();
builder.Services.AddSignalR();
builder.Services.AddScoped<HealthService>();
builder.Services.AddScoped<CreateTenant.Handler>();
builder.Services.AddScoped<RegisterTenant.Handler>();
builder.Services.AddScoped<CreatePatient.Handler>();
builder.Services.AddScoped<GetPatient.Handler>();
builder.Services.AddScoped<ListPatients.Handler>();
builder.Services.AddScoped<CreateAppointment.Handler>();
builder.Services.AddScoped<RescheduleAppointment.Handler>();
builder.Services.AddScoped<UpdateAppointment.Handler>();
builder.Services.AddScoped<ChangeAppointmentStatus.Handler>();
builder.Services.AddScoped<DoctorScheduling.Handler>();
builder.Services.AddSingleton<Hms.Api.Features.Appointments.AppointmentUpdates>();
builder.Services.AddScoped<ListAppointments.Handler>();
builder.Services.AddScoped<Dashboard.Handler>();
builder.Services.AddScoped<Memberships.Handler>();
builder.Services.AddScoped<Dashboard.DashboardStatsCache>();
var redisConfiguration = builder.Configuration["Redis:Configuration"];
if (string.IsNullOrWhiteSpace(redisConfiguration))
{
    if (!builder.Environment.IsDevelopment())
    {
        throw new InvalidOperationException(
            "Redis:Configuration must be configured outside Development.");
    }

    redisConfiguration = "127.0.0.1:6379";
}

var redisOptions = ConfigurationOptions.Parse(redisConfiguration);
redisOptions.AbortOnConnectFail = false;
redisOptions.ConnectRetry = 1;
redisOptions.ConnectTimeout = 2000;
redisOptions.AsyncTimeout = 2000;
redisOptions.SyncTimeout = 2000;

var redisMultiplexer = ConnectionMultiplexer.Connect(redisOptions);
builder.Services.AddSingleton<IConnectionMultiplexer>(redisMultiplexer);

builder.Services.AddStackExchangeRedisCache(options =>
{
    options.InstanceName = "hms:";
    options.ConnectionMultiplexerFactory = () =>
        Task.FromResult<IConnectionMultiplexer>(redisMultiplexer);
});


builder.Services.AddDbContext<HmsDbContext>(options =>
{
    options.UseNpgsql(
        builder.Configuration.GetConnectionString("HmsDatabase"));
});

builder.Services
    .AddAuthentication("Bearer")
    .AddJwtBearer("Bearer", options =>
    {
        options.TokenValidationParameters = new()
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,

            ValidIssuer = jwtIssuer,
            ValidAudience = jwtAudience,

            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(jwtKey))
        };
        options.Events = new Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.Request.Path;

                if (!string.IsNullOrEmpty(accessToken) &&
                    path.StartsWithSegments("/hubs/hospital"))
                {
                    context.Token = accessToken;
                }

                return Task.CompletedTask;
            },
            OnTokenValidated = context =>
            {
                var userId = context.Principal?.FindFirstValue(
                    ClaimTypes.NameIdentifier);
                var sessionId = context.Principal?.FindFirst("sid")?.Value;
                if (!Guid.TryParse(userId, out var parsedUserId) ||
                    parsedUserId == Guid.Empty ||
                    !Guid.TryParse(sessionId, out var parsedSessionId) ||
                    parsedSessionId == Guid.Empty)
                {
                    context.Fail("The access token has no active session.");
                }

                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

var corsOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>();
if (corsOrigins is null || corsOrigins.Length == 0)
{
    if (!builder.Environment.IsDevelopment())
    {
        throw new InvalidOperationException(
            "At least one Cors:AllowedOrigins value must be configured outside Development.");
    }

    corsOrigins = ["http://localhost:5173"];
}

builder.Services.AddCors(options =>
{
    options.AddPolicy("HmsWeb", policy =>
    {
        policy
            .WithOrigins(corsOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

// services...
var app = builder.Build();
app.UseCors("HmsWeb");
app.UseMiddleware<ExceptionHandlingMiddleware>();
app.UseAuthentication();
app.UseMiddleware<ActiveSessionMiddleware>();
app.UseAuthorization();
app.UseMiddleware<TenantMiddleware>();



app.MapGet("/api/health", (HealthService healthService) =>
{
    var status = healthService.GetStatus();

    return Results.Ok(new
    {
        status
    });
});
app.MapGet("/api/tenant-context", (
    ITenantContext tenantContext) =>
{
    return Results.Ok(new
    {
        tenantId = tenantContext.TenantId
    });
});
Register.Endpoint.Map(app);
Login.Endpoint.Map(app);
Hms.Api.Features.Auth.Logout.Endpoint.Map(app);
Hms.Api.Features.Auth.Session.Endpoint.Map(app);
CreateClinicalRecord.Endpoint.Map(app);
ListClinicalRecords.Endpoint.Map(app);
UpdateClinicalRecord.Endpoint.Map(app);
DeleteClinicalRecord.Endpoint.Map(app);
CreateTenant.Endpoint.Map(app);
RegisterTenant.Endpoint.Map(app);
CreatePatient.Endpoint.Map(app);
GetPatient.Endpoint.Map(app);
ListPatients.Endpoint.Map(app);
CreateAppointment.Endpoint.Map(app);
RescheduleAppointment.Endpoint.Map(app);
UpdateAppointment.Endpoint.Map(app);
ChangeAppointmentStatus.Endpoint.Map(app);
DoctorScheduling.Endpoint.Map(app);
Hms.Api.Features.Appointments.AppointmentUpdatesEndpoint.Map(app);
ListAppointments.Endpoint.Map(app);
Dashboard.Endpoint.Map(app);
Memberships.Endpoint.Map(app);
SyncAppointments.Endpoint.Map(app);
app.MapHub<HospitalHub>("/hubs/hospital");

app.Run();
// using Microsoft.AspNetCore.Identity;

// var hasher = new PasswordHasher<object>();

// var hash = hasher.HashPassword(
//     new object(),
//     "Admin@123");

// Console.WriteLine(hash);