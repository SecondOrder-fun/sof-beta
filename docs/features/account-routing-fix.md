# Account Routing Fix - 2025-10-03

## Problem

The "My Account" navigation had inconsistent behavior:

- **When logged in**: Navigated to `/users/<address>` (UserProfile component)
- **When NOT logged in**: Navigated to `/account` (AccountPage component)

This created two different pages showing similar content with different structures and titles, causing confusion.

## Solution

Consolidated the routing to use a single component (`UserProfile`) for both cases:

### 1. Updated Routing (`main.jsx`)

```javascript
// Before:
{
  path: 'account',
  element: <AccountPage />,
}

// After:
{
  path: 'account',
  element: <UserProfile />,
}
```

- Removed unused `AccountPage` import
- Both `/account` and `/users/:address` now use `UserProfile` component

### 2. Updated Header Navigation (`Header.jsx`)

```javascript
// Before:
<Link to={isConnected && address ? `/users/${address}` : "/account"}>
  {t('myAccount')}
</Link>

// After:
<Link to="/account">
  {t('myAccount')}
</Link>
```

- "My Account" always navigates to `/account`
- Simpler, more predictable behavior

### 3. Enhanced UserProfile Component

Added logic to handle both routes:

```javascript
const { address: addressParam } = useParams();
const { address: myAddress, isConnected } = useAccount();

// If no address param (e.g., /account route), use connected wallet address
const address = addressParam || myAddress;

// Determine if this is "My Account" view (no param) or viewing another user
const isMyAccount = !addressParam;
const pageTitle = isMyAccount ? t('myAccount') : t('userProfile');

// Show connect wallet message if viewing /account without connection
if (isMyAccount && !isConnected) {
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">{t('myAccount')}</h1>
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground">
            {t('connectWalletToViewAccount')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

### 4. Updated Users List (UsersIndex)

When viewing the users list, your own address now links to `/account` instead of `/users/<your-address>`:

```javascript
const isMyAddress = myAddress && addr?.toLowerCase?.() === myAddress.toLowerCase();
const linkTo = isMyAddress ? '/account' : `/users/${addr}`;
const linkText = isMyAddress ? t('viewYourAccount') : t('viewProfile');
```

### 5. Added Translation Keys

Added to all language files (`account.json`):

```json
{
  "myAccount": "My Account",
  "connectWalletToViewAccount": "Please connect your wallet to view your account."
}
```

Added to all language files (`common.json`):

```json
{
  "viewYourAccount": "View Your Account"
}
```

## Behavior After Fix

### Route: `/account` (My Account)

- **Not connected**: Shows "My Account" title with "Please connect your wallet" message
- **Connected**: Shows "My Account" title with user's own account data

### Route: `/users/<address>` (User Profile)

- Shows "User Profile" title with specified address data
- Can view any user's public profile
- Shows claim widgets only when viewing your own profile

## Files Changed

1. `src/main.jsx` - Updated routing, removed AccountPage import
2. `src/components/layout/Header.jsx` - Simplified My Account link
3. `src/routes/UserProfile.jsx` - Added logic to handle both routes
4. `src/routes/UsersIndex.jsx` - Updated to link to `/account` for own address
5. `public/locales/*/account.json` - Added translation keys (all 9 languages)
6. `public/locales/*/common.json` - Added "viewYourAccount" translation key

## Benefits

✅ **Consistent UX**: Same component handles both "My Account" and "User Profile"  
✅ **Simpler routing**: One route for personal account view  
✅ **Clear titles**: "My Account" vs "User Profile" based on context  
✅ **Better i18n**: Proper translation keys for all scenarios  
✅ **Removed duplication**: Eliminated redundant AccountPage component

## Testing

To verify the fix:

1. **Not logged in**: Visit `/account` → Should show "Please connect wallet" message
2. **Logged in**: Visit `/account` → Should show your account with "My Account" title
3. **Logged in**: Click "My Account" in header → Should go to `/account` with your data
4. **Logged in**: Visit `/users/<other-address>` → Should show "User Profile" title
5. **Logged in**: Visit `/users/<your-address>` → Should show "User Profile" title with claim widgets
6. **Logged in**: Visit `/users` list → Your address shows "View Your Account" link → Goes to `/account`
7. **Logged in**: Visit `/users` list → Other addresses show "View Profile" link → Goes to `/users/<address>`

---

**Status**: ✅ Complete - Account routing is now consistent and user-friendly
