import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import RoleSummary from './RoleSummary.jsx'
import UserAccountForm from './UserAccountForm.jsx'
import UsersNotice from './UsersNotice.jsx'
import UsersTable from './UsersTable.jsx'
import { archiveUser, createUser, getRoles, getUsers, updateUserStatus } from './usersService.js'
import { initialUserForm, normalizeUsername, validateAccount } from './usersUtils.js'

export default function UsersSection() {
  const { token, user } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [roles, setRoles] = useState([])
  const [form, setForm] = useState(initialUserForm)
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [updatingUserId, setUpdatingUserId] = useState('')
  const [archivingUserId, setArchivingUserId] = useState('')

  // Role cards are derived from the backend user list, not stored separately.
  const roleCounts = useMemo(
    () => roles.map((role) => ({
      role: role.name,
      count: accounts.filter((account) => account.role === role.name).length,
    })),
    [accounts, roles],
  )

  useEffect(() => {
    let isMounted = true

    async function loadUsersPage() {
      // Loads protected user data and roles using the JWT from AuthContext.
      setIsLoading(true)
      setNotice(null)

      try {
        const [usersPayload, rolesPayload] = await Promise.all([
          getUsers(token),
          getRoles(token),
        ])

        if (!isMounted) {
          return
        }

        const nextRoles = rolesPayload.roles || []
        setAccounts(usersPayload.users || [])
        setRoles(nextRoles)
        setForm((current) => ({
          ...current,
          role: current.role || nextRoles.find((role) => role.name === 'Production Supervisor')?.name || nextRoles[0]?.name || '',
        }))
      } catch (error) {
        if (isMounted) {
          setNotice({
            type: 'error',
            message: error.message || 'Unable to load user accounts.',
          })
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadUsersPage()

    return () => {
      isMounted = false
    }
  }, [token])

  function updateField(field, value) {
    // Clears the field error as soon as the admin edits that field again.
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: '' }))
    setNotice(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()

    const nextErrors = validateAccount(form, accounts)
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      return
    }

    setIsSubmitting(true)
    setNotice(null)

    try {
      // Backend hashes the password and stores the account in Supabase.
      const payload = await createUser(token, {
        name: form.name.trim(),
        username: normalizeUsername(form.username),
        email: form.email.trim().toLowerCase(),
        role: form.role,
        password: form.password,
      })

      setAccounts((current) => [payload.user, ...current])
      setForm({
        ...initialUserForm,
        role: form.role,
      })
      setNotice({
        type: 'success',
        message: `${payload.user.name} was created as ${payload.user.role}.`,
      })
    } catch (error) {
      setNotice({
        type: 'error',
        message: error.message || 'Unable to create user account.',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleStatusChange(account) {
    const nextStatus = account.status === 'Active' ? 'Inactive' : 'Active'
    setUpdatingUserId(account.id)
    setNotice(null)

    try {
      // Activate/deactivate is persisted by the backend; the table updates from the returned user.
      const payload = await updateUserStatus(token, account.id, nextStatus)
      setAccounts((current) => current.map((item) => (item.id === payload.user.id ? payload.user : item)))
      setNotice({
        type: 'success',
        message: `${payload.user.username} is now ${payload.user.status}.`,
      })
    } catch (error) {
      setNotice({
        type: 'error',
        message: error.message || 'Unable to update user status.',
      })
    } finally {
      setUpdatingUserId('')
    }
  }

  async function handleArchiveAccount(account) {
    const confirmed = window.confirm(`Archive ${account.username}? This removes access and hides the account from the normal user list.`)

    if (!confirmed) {
      return
    }

    setArchivingUserId(account.id)
    setNotice(null)

    try {
      const payload = await archiveUser(token, account.id)
      setAccounts((current) => current.filter((item) => item.id !== payload.user.id))
      setNotice({
        type: 'success',
        message: `${payload.user.username} was archived and can no longer log in.`,
      })
    } catch (error) {
      setNotice({
        type: 'error',
        message: error.message || 'Unable to archive user account.',
      })
    } finally {
      setArchivingUserId('')
    }
  }

  return (
    <div className="users-layout">
      <div className="users-primary-column">
        <UsersNotice notice={notice} />
        <UserAccountForm
          errors={errors}
          form={form}
          isLoading={isLoading}
          isSubmitting={isSubmitting}
          onFieldChange={updateField}
          onSubmit={handleSubmit}
          roles={roles}
        />
      </div>
      <RoleSummary accountCount={accounts.length} isLoading={isLoading} roleCounts={roleCounts} />
      <UsersTable
        accounts={accounts}
        currentUserId={user?.id}
        archivingUserId={archivingUserId}
        isLoading={isLoading}
        onArchiveAccount={handleArchiveAccount}
        onStatusChange={handleStatusChange}
        updatingUserId={updatingUserId}
      />
    </div>
  )
}
