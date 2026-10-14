using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Threading.Channels;

namespace Hms.Api.Features.Appointments;

public sealed class AppointmentUpdates
{
    private readonly ConcurrentDictionary<Guid, ConcurrentDictionary<Guid, Channel<string>>> _subscriptions = new();

    public IAsyncEnumerable<string> Subscribe(
        Guid tenantId,
        CancellationToken cancellationToken)
    {
        var subscriptionId = Guid.NewGuid();
        var channel = Channel.CreateBounded<string>(
            new BoundedChannelOptions(32)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
                SingleWriter = false
            });
        var tenantSubscriptions = _subscriptions.GetOrAdd(
            tenantId,
            _ => new ConcurrentDictionary<Guid, Channel<string>>());
        tenantSubscriptions[subscriptionId] = channel;
        return ReadAndRemoveAsync(
            tenantId,
            subscriptionId,
            channel,
            cancellationToken);
    }

    public void Publish(Guid tenantId, string eventName)
    {
        if (!_subscriptions.TryGetValue(tenantId, out var subscriptions))
        {
            return;
        }

        foreach (var channel in subscriptions.Values)
        {
            channel.Writer.TryWrite(eventName);
        }
    }

    private async IAsyncEnumerable<string> ReadAndRemoveAsync(
        Guid tenantId,
        Guid subscriptionId,
        Channel<string> channel,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        try
        {
            await foreach (var update in channel.Reader.ReadAllAsync(cancellationToken))
            {
                yield return update;
            }
        }
        finally
        {
            if (_subscriptions.TryGetValue(tenantId, out var subscriptions))
            {
                subscriptions.TryRemove(subscriptionId, out _);
                if (subscriptions.IsEmpty)
                {
                    _subscriptions.TryRemove(
                        new KeyValuePair<Guid, ConcurrentDictionary<Guid, Channel<string>>>(
                            tenantId,
                            subscriptions));
                }
            }
        }
    }
}
