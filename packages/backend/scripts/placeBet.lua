local roundId = redis.call('get', 'game:current_round')
if not roundId then return {0, 'no_round'} end

local phase = redis.call('get', 'game:phase')
if phase ~= 'betting' then return {0, 'phase'} end

local bettingEnd = redis.call('get', 'game:betting_end_time')
if not bettingEnd or tonumber(bettingEnd) < tonumber(ARGV[3]) then return {0, 'time'} end

local betsKey = 'round:' .. roundId .. ':bets'
if redis.call('hexists', betsKey, ARGV[1]) == 1 then return {0, 'duplicate'} end

local balanceKey = 'user:' .. ARGV[1] .. ':balance'
local balance = redis.call('get', balanceKey)
if not balance or tonumber(balance) < tonumber(ARGV[2]) then return {0, 'balance'} end

redis.call('incrbyfloat', balanceKey, -tonumber(ARGV[2]))
local newBalance = tonumber(redis.call('get', balanceKey))

redis.call('hset', betsKey, ARGV[1], ARGV[2])

local now = math.floor(tonumber(ARGV[3]))
local stateKey = 'live:state:' .. ARGV[1]
redis.call('hset', stateKey, 'name', ARGV[4], 'betAmount', ARGV[2], 'win', '', 'multiplier', '', 'timestamp', now)
redis.call('zadd', 'live:index', now, ARGV[1])

local count = redis.call('zcard', 'live:index')
if count > 50 then
  local oldest = redis.call('zrange', 'live:index', 0, 0)
  if oldest and #oldest > 0 then
    redis.call('zrem', 'live:index', oldest[1])
    redis.call('del', 'live:state:' .. oldest[1])
  end
end

return {1, newBalance}