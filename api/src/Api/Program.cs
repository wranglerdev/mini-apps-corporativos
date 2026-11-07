using System.Text.Json;
using System.Threading.RateLimiting;
using Domain;
using System.Text.Json.Serialization;
using Api;
using Infra;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<DomainExceptionHandler>();
builder.Services.Addapp(builder.Configuration);

// Formulários (rotas que podem ser públicas): limite por pessoa logada, ou por endereço IP quando sem login.
// Nativo do ASP.NET Core, sem pacote. Valores em Forms:SubmitsPerHour e Forms:RequestsPerMinute.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    static string Who(HttpContext ctx)
    {
        try { return "u:" + ctx.RequestServices.GetRequiredService<IUserProvider>().GetCurrentUser().Email; }
        catch (DomainException) { return "ip:" + ctx.Connection.RemoteIpAddress; }
    }
    var submits = builder.Configuration.GetValue("Forms:SubmitsPerHour", 5);
    var requests = builder.Configuration.GetValue("Forms:RequestsPerMinute", 120);
    o.AddPolicy("form-submit", ctx => RateLimitPartition.GetFixedWindowLimiter(Who(ctx),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = submits, Window = TimeSpan.FromHours(1) }));
    o.AddPolicy("forms", ctx => RateLimitPartition.GetFixedWindowLimiter(Who(ctx),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = requests, Window = TimeSpan.FromMinutes(1) }));
});

var app = builder.Build();
app.UseExceptionHandler();
app.UseRateLimiter();
app.MapControllers();
app.Services.InitDatabase();
app.Run();
