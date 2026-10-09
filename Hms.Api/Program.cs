using Microsoft.IdentityModel.Tokens;
using Hms.Api.Features.Health;
using Hms.Api.Infrastructure.Auth;
using Hms.Api.Infrastructure.Tenancy;
using Hms.Api.Infrastructure.ExceptionHandling;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Hms.Domain.Users;
using Hms.Infrastructure.MongoDB;
using CreateClinicalRecord = Hms.Api.Features.ClinicalRecords.CreateClinicalRecord;

using CreateTenant = Hms.Api.Features.Tenants.CreateTenant;
using Register = Hms.Api.Features.Auth.Register;
using Login = Hms.Api.Features.Auth.Login;
using CreatePatient = Hms.Api.Features.Patients.CreatePatient;
using GetPatient = Hms.Api.Features.Patients.GetPatient;
using ListPatients = Hms.Api.Features.Patients.ListPatients;
using CreateAppointment = Hms.Api.Features.Appointments.CreateAppointment;
using ListAppointments = Hms.Api.Features.Appointments.ListAppointments;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddScoped<CreateClinicalRecord.Handler>();
builder.Services.AddSingleton<MongoDbContext>();
builder.Services.AddProblemDetails();
builder.Services.AddScoped<Login.Handler>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();
builder.Services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddScoped<Register.Handler>();
builder.Services.AddScoped<ITenantContext, TenantContext>();
builder.Services.AddScoped<HealthService>();
builder.Services.AddScoped<CreateTenant.Handler>();
builder.Services.AddScoped<CreatePatient.Handler>();
builder.Services.AddScoped<GetPatient.Handler>();
builder.Services.AddScoped<ListPatients.Handler>();
builder.Services.AddScoped<CreateAppointment.Handler>();
builder.Services.AddScoped<ListAppointments.Handler>();


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

            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],

            IssuerSigningKey = new SymmetricSecurityKey(
                System.Text.Encoding.UTF8.GetBytes(
                    builder.Configuration["Jwt:Key"]!))
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddCors(options =>
{
    options.AddPolicy("HmsWeb", policy =>
    {
        policy
            .WithOrigins("http://localhost:5173")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

// services...
var app = builder.Build();
app.UseCors("HmsWeb");
app.UseMiddleware<ExceptionHandlingMiddleware>();
app.UseAuthentication();
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
CreateClinicalRecord.Endpoint.Map(app);
CreateTenant.Endpoint.Map(app);
CreatePatient.Endpoint.Map(app);
GetPatient.Endpoint.Map(app);
ListPatients.Endpoint.Map(app);
CreateAppointment.Endpoint.Map(app);
ListAppointments.Endpoint.Map(app);


app.Run();
// using Microsoft.AspNetCore.Identity;

// var hasher = new PasswordHasher<object>();

// var hash = hasher.HashPassword(
//     new object(),
//     "Admin@123");

// Console.WriteLine(hash);