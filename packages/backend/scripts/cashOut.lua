local roundId = redis.call('get', 'game:current_round')
if not roundId then return {0, 'no_round'} end

local phase = redis.call('get', 'game:phase')
if phase ~= 'flying' then return {0, 'phase'} end

local betsKey = 'round:' .. roundId .. ':bets'
local betAmount = redis.call('hget', betsKey, ARGV[1])
if not betAmount then return {0, 'no_bet'} end

local cashoutsKey = 'round:' .. roundId .. ':cashouts'
if redis.call('hexists', cashoutsKey, ARGV[1]) == 1 then return {0, 'duplicate'} end

local crashPoint = tonumber(redis.call('get', 'game:crash_point') or 100)
local currentMultiplier = tonumber(redis.call('get', 'game:multiplier') or 1)
if currentMultiplier >= crashPoint then return {0, 'crashed'} end

local win = tonumber(betAmount) * currentMultiplier
local balanceKey = 'user:' .. ARGV[1] .. ':balance'
redis.call('incrbyfloat', balanceKey, win)
local newBalance = tonumber(redis.call('get', balanceKey))

redis.call('hset', cashoutsKey, ARGV[1], win)

local now = math.floor(tonumber(ARGV[2]))
local stateKey = 'live:state:' .. ARGV[1]
local existing = redis.call('hgetall', stateKey)
if existing and #existing > 0 then
  redis.call('hset', stateKey, 'win', win, 'multiplier', currentMultiplier, 'timestamp', now)
  redis.call('zadd', 'live:index', now, ARGV[1])
end

return {1, newBalance, win}