namespace Hms.Api.Features.Memberships;

public static class Endpoint
{
    public static void Map(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet(
            "/api/memberships",
            async (
                Handler handler,
                CancellationToken cancellationToken) =>
                Results.Ok(await handler.ListAsync(cancellationToken)));

        endpoints.MapPost(
            "/api/memberships",
            async (
                Command command,
                Handler handler,
                CancellationToken cancellationToken) =>
            {
                var membership = await handler.AddAsync(
                    command,
                    cancellationToken);
                return Results.Created(
                    $"/api/memberships/{membership.MembershipId}",
                    membership);
            });

        endpoints.MapPut(
            "/api/memberships/{membershipId:guid}",
            async (
                Guid membershipId,
                ChangeRoleCommand command,
                Handler handler,
                CancellationToken cancellationToken) =>
                    Results.Ok(await handler.ChangeRoleAsync(
                        membershipId,
                        command,
                        cancellationToken)));

        endpoints.MapDelete(
            "/api/memberships/{membershipId:guid}",
            async (
                Guid membershipId,
                Handler handler,
                CancellationToken cancellationToken) =>
            {
                await handler.RemoveAsync(membershipId, cancellationToken);
                return Results.NoContent();
            });
    }
}
