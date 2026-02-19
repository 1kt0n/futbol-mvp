import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn, apiFetch, Banner, StatPill } from './App.jsx'
import TournamentsAdminTab from './TournamentsAdminTab.jsx'

// Modal genérico reutilizable
function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 rounded-3xl border border-white/10 p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">{title}</h2>
          <button
            onClick={onClose}
            data-testid="admin-modal-close-btn"
            className="text-white/60 hover:text-white text-2xl leading-none"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function AdminPanel() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('eventos')
  const [err, setErr] = useState('')
  const [toast, setToast] = useState(null)
  const [busy, setBusy] = useState(false)
  const [userRole, setUserRole] = useState(null) // 'admin' | 'captain' | null

  // Estado para Eventos
  const [eventsList, setEventsList] = useState([])
  const [activeEvent, setActiveEvent] = useState(null)
  const [showCreateEvent, setShowCreateEvent] = useState(false)
  const [showCreateCourt, setShowCreateCourt] = useState(false)
  const [showEditCourt, setShowEditCourt] = useState(false)
  const [selectedEventId, setSelectedEventId] = useState(null)
  const [selectedCourt, setSelectedCourt] = useState(null)

  // Estado para Usuarios
  const [users, setUsers] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateUser, setShowCreateUser] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)
  const [showResetPin, setShowResetPin] = useState(false)
  const [showEditRoles, setShowEditRoles] = useState(false)

  // Estado para Auditoría
  const [auditLogs, setAuditLogs] = useState([])
  const [auditFilters, setAuditFilters] = useState({ event_id: '', action: '' })

  // Modal de confirmación
  const [confirmModal, setConfirmModal] = useState(null)

  // Check access on mount
  useEffect(() => {
    async function checkAccess() {
      try {
        const me = await apiFetch('/me')

        if (me.is_admin) {
          setUserRole('admin')
        } else {
          // Chequear si es capitán
          await apiFetch('/events/active')
          // Simplificado: si hay evento activo y el usuario está asignado como capitán en alguna cancha
          // (esto requeriría que /events/active incluya info de capitanes por cancha)
          setUserRole('captain')
          setTab('eventos')
        }
      } catch {
        setErr('Acceso denegado. Requiere permisos de administrador.')
        setTimeout(() => navigate('/'), 2000)
      }
    }
    checkAccess()
  }, [])

  // Load lista de eventos (admin)
  async function loadEvents() {
    setBusy(true)
    try {
      const data = await apiFetch('/admin/events')
      setEventsList(data.events || [])
      const urlEventId = new URLSearchParams(window.location.search).get('event_id') || null
      // Si no hay evento seleccionado, seleccionar el primero
      if (urlEventId) {
        setSelectedEventId(urlEventId)
        await loadEventDetail(urlEventId)
      } else if (!selectedEventId && data.events?.length > 0) {
        const firstId = data.events[0].id
        setSelectedEventId(firstId)
        await loadEventDetail(firstId)
      } else if (selectedEventId) {
        await loadEventDetail(selectedEventId)
      } else {
        setActiveEvent(null)
      }
    } catch (err) {
      setErr(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Load detalle de un evento específico
  async function loadEventDetail(eventId) {
    setBusy(true)
    try {
      const data = await apiFetch(`/admin/events/${eventId}/detail`)
      setActiveEvent(data)
      setSelectedEventId(eventId)
    } catch (err) {
      setErr(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Load usuarios
  async function loadUsers() {
    setBusy(true)
    try {
      const data = await apiFetch(`/admin/users${searchQuery ? `?query=${encodeURIComponent(searchQuery)}` : ''}`)
      setUsers(data.users || [])
    } catch (err) {
      setErr(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Load audit logs
  async function loadAudit() {
    setBusy(true)
    try {
      const params = new URLSearchParams()
      if (auditFilters.event_id) params.append('event_id', auditFilters.event_id)
      if (auditFilters.action) params.append('action', auditFilters.action)

      const data = await apiFetch(`/admin/audit?${params.toString()}`)
      setAuditLogs(data.logs || [])
    } catch (err) {
      setErr(err.message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (tab === 'eventos' && userRole) loadEvents()
    if (tab === 'usuarios' && userRole === 'admin') loadUsers()
    if (tab === 'auditoria' && userRole === 'admin') loadAudit()
    // eslint-disable-next-line
  }, [tab, userRole])

  // Handler: Crear evento
  async function handleCreateEvent(formData) {
    setBusy(true)
    try {
      // Convertir strings vacíos a null para campos opcionales
      const payload = {
        ...formData,
        close_at: formData.close_at && formData.close_at.trim() ? formData.close_at : null
      }
      await apiFetch('/admin/events', {
        method: 'POST',
        body: payload
      })
      setToast('Evento creado exitosamente')
      setShowCreateEvent(false)
      await loadEvents()
    } catch (err) {
      setErr(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Handler: Cerrar evento
  async function handleCloseEvent(eventId) {
    setConfirmModal({
      title: '¿Cerrar evento?',
      message: 'El evento se cerrará y no se podrán agregar más inscripciones desde usuarios regulares.',
      onConfirm: async () => {
        setBusy(true)
        try {
          await apiFetch(`/admin/events/${eventId}/close`, { method: 'POST' })
          setToast('Evento cerrado')
          setConfirmModal(null)
          await loadEvents()
        } catch (err) {
          setErr(err.message)
        } finally {
          setBusy(false)
        }
      }
    })
  }

  // Handler: Reabrir evento
  async function handleReopenEvent(eventId) {
    setConfirmModal({
      title: '¿Reabrir evento?',
      message: 'El evento volverá a estar disponible para inscripciones.',
      onConfirm: async () => {
        setBusy(true)
        try {
          await apiFetch(`/admin/events/${eventId}/open`, { method: 'POST' })
          setToast('Evento reabierto')
          setConfirmModal(null)
          await loadEvents()
        } catch (err) {
          setErr(err.message)
        } finally {
          setBusy(false)
        }
      }
    })
  }

  // Handler: Finalizar evento
  async function handleFinalizeEvent(eventId) {
    setConfirmModal({
      title: '¿Finalizar evento?',
      message: 'El evento será archivado y no aparecerá más en la lista principal. Esta acción puede revertirse.',
      onConfirm: async () => {
        setBusy(true)
        try {
          await apiFetch(`/admin/events/${eventId}/finalize`, { method: 'POST' })
          setToast('Evento finalizado')
          setConfirmModal(null)
          await loadEvents()
        } catch (err) {
          setErr(err.message)
        } finally {
          setBusy(false)
        }
      }
    })
  }

  // Handler: Abrir cancha
  async function handleOpenCourt(eventId, courtId) {
    setBusy(true)
    try {
      await apiFetch(`/admin/events/${eventId}/courts/${courtId}/open`, { method: 'POST' })
      setToast('Cancha abierta')
      await loadEvents()
    } catch (err) {
      setErr(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Handler: Cerrar cancha
  async function handleCloseCourt(eventId, courtId) {
    setConfirmModal({
      title: '¿Cerrar cancha?',
      message: 'La cancha se cerrará y no se podrán agregar más jugadores.',
      onConfirm: async () => {
        setBusy(true)
        try {
          await apiFetch(`/admin/events/${eventId}/courts/${courtId}/close`, { method: 'POST' })
          setToast('Cancha cerrada')
          setConfirmModal(null)
          await loadEvents()
        } catch (err) {
          setErr(err.message)
        } finally {
          setBusy(false)
        }
      }
    })
  }

  // Handler: Crear cancha
  async function handleCreateCourt(eventId, formData) {
    setBusy(true)
    try {
      await apiFetch(`/admin/events/${eventId}/courts`, {
        method: 'POST',
        body: formData
      })
      setToast('Cancha creada')
      setShowCreateCourt(false)
      await loadEvents()
    } catch (err) {
      setErr(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Handler: Editar cancha
  async function handleUpdateCourt(eventId, courtId, formData) {
    setBusy(true)
    try {
      await apiFetch(`/admin/events/${eventId}/courts/${courtId}`, {
        method: 'PATCH',
        body: formData
      })
      setToast('Cancha actualizada')
      setShowEditCourt(false)
      setSelectedCourt(null)
      await loadEvents()
    } catch (err) {
      setErr(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Handler: Eliminar cancha
  async function handleDeleteCourt(eventId, court) {
    setConfirmModal({
      title: 'Eliminar cancha',
      message: `Se eliminara '${court.name}'. Esta accion no se puede deshacer.`,
      onConfirm: async () => {
        setBusy(true)
        try {
          await apiFetch(`/admin/events/${eventId}/courts/${court.court_id}`, { method: 'DELETE' })
          setToast('Cancha eliminada')
          setConfirmModal(null)
          if (selectedCourt?.court_id === court.court_id) {
            setShowEditCourt(false)
            setSelectedCourt(null)
          }
          await loadEvents()
        } catch (err) {
          setErr(err.message)
        } finally {
          setBusy(false)
        }
      }
    })
  }

  // Handler: Crear usuario
  async function handleCreateUser(formData) {
    setBusy(true)
    try {
      await apiFetch('/admin/users', {
        method: 'POST',
        body: formData
      })
      setToast('Usuario creado')
      setShowCreateUser(false)
      await loadUsers()
    } catch (err) {
      setErr(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Handler: Reset PIN
  async function handleResetPin(userId, pin) {
    setBusy(true)
    try {
      await apiFetch(`/admin/users/${userId}/pin`, {
        method: 'POST',
        body: { pin }
      })
      setToast('PIN reseteado')
      setShowResetPin(false)
      setSelectedUser(null)
    } catch (err) {
      setErr(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Handler: Toggle usuario activo
  async function handleToggleActive(userId, currentState) {
    setBusy(true)
    try {
      await apiFetch(`/admin/users/${userId}`, {
        method: 'PATCH',
        body: { is_active: !currentState }
      })
      setToast(`Usuario ${!currentState ? 'activado' : 'desactivado'}`)
      await loadUsers()
    } catch (err) {
      setErr(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Handler: Actualizar roles
  async function handleUpdateRoles(userId, roles) {
    setBusy(true)
    try {
      await apiFetch(`/admin/users/${userId}/roles`, {
        method: 'PUT',
        body: { roles }
      })
      setToast('Roles actualizados')
      setShowEditRoles(false)
      setSelectedUser(null)
      await loadUsers()
    } catch (err) {
      setErr(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Si no hay permisos aún, mostrar loading
  if (!userRole) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-white flex items-center justify-center">
        <div className="text-white/60">Verificando permisos...</div>
      </div>
    )
  }

  return (
    <div className="page-enter min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-white">
      <div className="mx-auto max-w-7xl px-4 py-6">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Panel de Administración</h1>
            <p className="text-white/60 mt-1">
              Gestión de eventos, usuarios y auditoría
              {userRole === 'captain' && ' (Vista Capitán)'}
            </p>
          </div>
          <button
            onClick={() => navigate('/')}
            className="self-start rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10"
          >
            ← Volver
          </button>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-2 overflow-x-auto border-b border-white/10 pb-1">
          <button
            onClick={() => setTab('eventos')}
            data-testid="admin-tab-eventos"
            className={cn(
              "whitespace-nowrap px-4 py-3 rounded-t-lg font-semibold transition-colors",
              tab === 'eventos'
                ? "bg-white/10 border-b-2 border-emerald-400 text-white"
                : "text-white/60 hover:bg-white/5 hover:text-white"
            )}
          >
            Eventos
          </button>
          {userRole === 'admin' && (
            <>
              <button
                onClick={() => setTab('usuarios')}
                className={cn(
                  "whitespace-nowrap px-4 py-3 rounded-t-lg font-semibold transition-colors",
                  tab === 'usuarios'
                    ? "bg-white/10 border-b-2 border-emerald-400 text-white"
                    : "text-white/60 hover:bg-white/5 hover:text-white"
                )}
              >
                Usuarios
              </button>
              <button
                onClick={() => setTab('auditoria')}
                className={cn(
                  "whitespace-nowrap px-4 py-3 rounded-t-lg font-semibold transition-colors",
                  tab === 'auditoria'
                    ? "bg-white/10 border-b-2 border-emerald-400 text-white"
                    : "text-white/60 hover:bg-white/5 hover:text-white"
                )}
              >
                Auditoria
              </button>
              <button
                onClick={() => setTab('notificaciones')}
                className={cn(
                  "whitespace-nowrap px-4 py-3 rounded-t-lg font-semibold transition-colors",
                  tab === 'notificaciones'
                    ? "bg-white/10 border-b-2 border-emerald-400 text-white"
                    : "text-white/60 hover:bg-white/5 hover:text-white"
                )}
              >
                Notificaciones
              </button>
              <button
                onClick={() => setTab('torneos')}
                data-testid="admin-tab-torneos"
                className={cn(
                  "whitespace-nowrap px-4 py-3 rounded-t-lg font-semibold transition-colors",
                  tab === 'torneos'
                    ? "bg-white/10 border-b-2 border-emerald-400 text-white"
                    : "text-white/60 hover:bg-white/5 hover:text-white"
                )}
              >
                Torneos
              </button>
            </>
          )}
        </div>

        {/* Error banner */}
        {err && (
          <Banner kind="error" title="Error" onClose={() => setErr('')}>
            {err}
          </Banner>
        )}

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-4 left-4 right-4 z-50 rounded-2xl bg-emerald-500 px-6 py-3 text-center text-white shadow-xl animate-fade-in sm:left-auto sm:right-6 sm:text-left">
            {toast}
          </div>
        )}

        {/* Tab Content */}
        <div className="mt-6">
          {tab === 'eventos' && (
            <EventosTab
              eventsList={eventsList}
              selectedEventId={selectedEventId}
              onSelectEvent={(id) => loadEventDetail(id)}
              activeEvent={activeEvent}
              busy={busy}
              userRole={userRole}
              onCreateEvent={() => setShowCreateEvent(true)}
              onCloseEvent={handleCloseEvent}
              onReopenEvent={handleReopenEvent}
              onFinalizeEvent={handleFinalizeEvent}
              onOpenCourt={handleOpenCourt}
              onCloseCourt={handleCloseCourt}
              onEditCourt={(court) => {
                setSelectedCourt(court)
                setShowEditCourt(true)
              }}
              onDeleteCourt={handleDeleteCourt}
              onCreateCourt={() => setShowCreateCourt(true)}
              onRefresh={loadEvents}
            />
          )}

          {tab === 'usuarios' && userRole === 'admin' && (
            <UsuariosTab
              users={users}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              busy={busy}
              onSearch={loadUsers}
              onCreate={() => setShowCreateUser(true)}
              onResetPin={(user) => {
                setSelectedUser(user)
                setShowResetPin(true)
              }}
              onToggleActive={handleToggleActive}
              onEditRoles={(user) => {
                setSelectedUser(user)
                setShowEditRoles(true)
              }}
            />
          )}

          {tab === 'auditoria' && userRole === 'admin' && (
            <AuditoriaTab
              logs={auditLogs}
              filters={auditFilters}
              setFilters={setAuditFilters}
              busy={busy}
              onRefresh={loadAudit}
            />
          )}

          {tab === 'notificaciones' && userRole === 'admin' && (
            <NotificationsTab />
          )}

          {tab === 'torneos' && userRole === 'admin' && (
            <TournamentsAdminTab />
          )}
        </div>

        {/* Modals */}
        <Modal isOpen={showCreateEvent} onClose={() => setShowCreateEvent(false)} title="Crear Evento">
          <CreateEventForm onSubmit={handleCreateEvent} busy={busy} />
        </Modal>

        <Modal isOpen={showCreateCourt} onClose={() => setShowCreateCourt(false)} title="Crear Cancha">
          <CreateCourtForm
            onSubmit={(data) => handleCreateCourt(selectedEventId, data)}
            busy={busy}
            testIdPrefix="create-court"
            submitLabel="Crear Cancha"
          />
        </Modal>

        <Modal
          isOpen={showEditCourt}
          onClose={() => {
            setShowEditCourt(false)
            setSelectedCourt(null)
          }}
          title="Editar Cancha"
        >
          <CreateCourtForm
            onSubmit={(data) => handleUpdateCourt(selectedEventId, selectedCourt?.court_id, data)}
            busy={busy}
            initialData={selectedCourt}
            testIdPrefix="edit-court"
            submitLabel="Guardar cambios"
          />
        </Modal>

        <Modal isOpen={showCreateUser} onClose={() => setShowCreateUser(false)} title="Crear Usuario">
          <CreateUserForm onSubmit={handleCreateUser} busy={busy} />
        </Modal>

        <Modal
          isOpen={showResetPin}
          onClose={() => {
            setShowResetPin(false)
            setSelectedUser(null)
          }}
          title="Reset PIN"
        >
          <ResetPinForm
            user={selectedUser}
            onSubmit={(pin) => handleResetPin(selectedUser?.id, pin)}
            busy={busy}
          />
        </Modal>

        <Modal
          isOpen={showEditRoles}
          onClose={() => {
            setShowEditRoles(false)
            setSelectedUser(null)
          }}
          title="Editar Roles"
        >
          <EditRolesForm
            user={selectedUser}
            onSubmit={(roles) => handleUpdateRoles(selectedUser?.id, roles)}
            busy={busy}
          />
        </Modal>

        <Modal
          isOpen={!!confirmModal}
          onClose={() => setConfirmModal(null)}
          title={confirmModal?.title || 'Confirmar'}
        >
          <div className="space-y-4">
            <p className="text-white/80">{confirmModal?.message}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={confirmModal?.onConfirm}
                disabled={busy}
                data-testid="admin-confirm-modal-confirm-btn"
                className="flex-1 rounded-xl bg-rose-500 hover:bg-rose-600 px-4 py-3 font-semibold disabled:opacity-50"
              >
                Confirmar
              </button>
              <button
                onClick={() => setConfirmModal(null)}
                data-testid="admin-confirm-modal-cancel-btn"
                className="flex-1 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-3 font-semibold"
              >
                Cancelar
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  )
}

// ==================== TAB COMPONENTS ====================

function EventosTab({
  eventsList,
  selectedEventId,
  onSelectEvent,
  activeEvent,
  busy,
  userRole,
  onCreateEvent,
  onCloseEvent,
  onReopenEvent,
  onFinalizeEvent,
  onOpenCourt,
  onCloseCourt,
  onEditCourt,
  onDeleteCourt,
  onCreateCourt,
  onRefresh
}) {
  const event = activeEvent?.event
  const courts = activeEvent?.courts || []
  const waitlist = activeEvent?.waitlist || []

  // Helper para determinar el badge de estado
  function getStatusBadge(status) {
    if (status === 'OPEN') {
      return <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-sm font-semibold border border-emerald-500/30">ABIERTO</span>
    }
    if (status === 'CLOSED') {
      return <span className="px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 text-sm font-semibold border border-rose-500/30">CERRADO</span>
    }
    if (status === 'FINALIZED') {
      return <span className="px-3 py-1 rounded-full bg-zinc-500/20 text-zinc-300 text-sm font-semibold border border-zinc-500/30">FINALIZADO</span>
    }
    return null
  }

  return (
    <div className="space-y-6" data-testid="admin-events-tab">
      {/* Botones de acción */}
      {userRole === 'admin' && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={onCreateEvent}
            data-testid="admin-event-create-btn"
            className="rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-2 font-semibold"
          >
            + Crear Evento
          </button>
          {event && (
            <>
              <button
                onClick={onCreateCourt}
                data-testid="admin-event-create-court-btn"
                className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2 font-semibold"
              >
                + Crear Cancha
              </button>
              {event.status === 'OPEN' && (
                <button
                  onClick={() => onCloseEvent(event.id)}
                  data-testid="admin-event-close-btn"
                  className="rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 px-4 py-2 font-semibold"
                >
                  Cerrar Evento
                </button>
              )}
              {event.status === 'CLOSED' && (
                <>
                  <button
                    onClick={() => onReopenEvent(event.id)}
                    data-testid="admin-event-reopen-btn"
                    className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 px-4 py-2 font-semibold"
                  >
                    Reabrir Evento
                  </button>
                  <button
                    onClick={() => onFinalizeEvent(event.id)}
                    data-testid="admin-event-finalize-btn"
                    className="rounded-xl border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 px-4 py-2 font-semibold"
                  >
                    Finalizar / Archivar
                  </button>
                </>
              )}
              {event.status === 'FINALIZED' && (
                <button
                  onClick={() => onReopenEvent(event.id)}
                  data-testid="admin-event-reactivate-btn"
                  className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 px-4 py-2 font-semibold"
                >
                  Reactivar Evento
                </button>
              )}
            </>
          )}
          <button
            onClick={onRefresh}
            disabled={busy}
            data-testid="admin-events-refresh-btn"
            className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2 font-semibold disabled:opacity-50"
          >
            {busy ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>
      )}

      {/* Selector de eventos */}
      {eventsList.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="text-sm font-semibold text-white/60 mb-3">Eventos ({eventsList.length})</h3>
          <div className="flex gap-2 flex-wrap">
            {eventsList.map(ev => (
              <button
                key={ev.id}
                onClick={() => onSelectEvent(ev.id)}
                data-testid={`admin-event-select-${ev.id}`}
                className={cn(
                  "px-4 py-2 rounded-xl text-sm font-semibold transition-colors border",
                  selectedEventId === ev.id
                    ? "bg-emerald-500/20 border-emerald-400/50 text-emerald-300"
                    : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white"
                )}
              >
                {ev.title}
                <span className={cn(
                  "ml-2 px-2 py-0.5 rounded-full text-xs",
                  ev.status === 'OPEN' ? "bg-emerald-500/20 text-emerald-300" :
                  ev.status === 'CLOSED' ? "bg-rose-500/20 text-rose-300" :
                  "bg-zinc-500/20 text-zinc-300"
                )}>
                  {ev.status === 'OPEN' ? 'Abierto' : ev.status === 'CLOSED' ? 'Cerrado' : 'Finalizado'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Evento seleccionado - detalle */}
      {!event ? (
        <Banner kind="info" title="Sin evento seleccionado">
          {eventsList.length === 0 ? 'No hay eventos creados.' : 'Seleccioná un evento para ver su detalle.'}
        </Banner>
      ) : (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold" data-testid="admin-event-active-title">{event.title}</h2>
              <p className="text-white/60 mt-1">{event.location_name}</p>
              <p className="text-white/50 text-sm mt-1">
                Inicia: {new Date(event.starts_at).toLocaleString()}
              </p>
            </div>
            {getStatusBadge(event.status)}
          </div>

          {/* Canchas */}
          <div className="mt-6 space-y-4">
            <h3 className="text-lg font-semibold">Canchas ({courts.length})</h3>
            <div className="grid gap-4 md:grid-cols-2">
              {courts.map(court => (
                <div key={court.court_id} className="rounded-2xl border border-white/10 bg-black/20 p-4" data-testid={`admin-court-card-${court.court_id}`}>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold flex items-center gap-2">
                      {court.name}
                      {!court.is_open && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs border border-amber-500/30">
                          CERRADA
                        </span>
                      )}
                      {court.is_open && court.occupied >= court.capacity && (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-xs border border-rose-500/30">
                          LLENA
                        </span>
                      )}
                    </h4>
                    <StatPill
                      label="Ocupación"
                      value={`${court.occupied}/${court.capacity}`}
                      tone={court.occupied >= court.capacity ? 'warn' : 'good'}
                    />
                  </div>
                  <div className="text-sm text-white/60">
                    {court.players.length} jugadores confirmados
                  </div>

                  {/* Botones de gestión de cancha - Solo admin */}
                  {userRole === 'admin' && event.status !== 'FINALIZED' && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {court.is_open ? (
                        <button
                          onClick={() => onCloseCourt(event.id, court.court_id)}
                          data-testid={`admin-court-close-${court.court_id}`}
                          className="text-xs rounded-lg border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 px-3 py-1.5"
                        >
                          Cerrar Cancha
                        </button>
                      ) : (
                        <button
                          onClick={() => onOpenCourt(event.id, court.court_id)}
                          data-testid={`admin-court-open-${court.court_id}`}
                          className="text-xs rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 px-3 py-1.5"
                        >
                          Abrir Cancha
                        </button>
                      )}
                      <button
                        onClick={() => onEditCourt(court)}
                        data-testid={`admin-court-edit-${court.court_id}`}
                        className="text-xs rounded-lg border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 px-3 py-1.5"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => onDeleteCourt(event.id, court)}
                        data-testid={`admin-court-delete-${court.court_id}`}
                        className="text-xs rounded-lg border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 px-3 py-1.5"
                      >
                        Eliminar
                      </button>
                    </div>
                  )}

                  {/* Lista de jugadores - simplificada */}
                  <div className="mt-3 space-y-1 max-h-40 overflow-y-auto">
                    {court.players.slice(0, 5).map((p, i) => (
                      <div key={i} className="text-xs text-white/50">
                        {p.name} ({p.type})
                      </div>
                    ))}
                    {court.players.length > 5 && (
                      <div className="text-xs text-white/40">
                        ... y {court.players.length - 5} más
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Waitlist */}
          {waitlist.length > 0 && (
            <div className="mt-6" data-testid="admin-waitlist-section">
              <h3 className="text-lg font-semibold mb-3">Lista de Espera ({waitlist.length})</h3>
              <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4">
                {waitlist.slice(0, 10).map((w, i) => (
                  <div key={i} className="text-sm text-white/70">
                    {w.name} ({w.type})
                  </div>
                ))}
                {waitlist.length > 10 && (
                  <div className="text-sm text-white/50 mt-2">
                    ... y {waitlist.length - 10} más
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function UsuariosTab({ users, searchQuery, setSearchQuery, busy, onSearch, onCreate, onResetPin, onToggleActive, onEditRoles }) {
  return (
    <div className="space-y-6">
      {/* Búsqueda y acciones */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && onSearch()}
          placeholder="Buscar por nombre o teléfono..."
          className="flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
        />
        <button
          onClick={onSearch}
          disabled={busy}
          className="rounded-xl bg-white/10 hover:bg-white/20 px-4 py-2 font-semibold disabled:opacity-50"
        >
          Buscar
        </button>
        <button
          onClick={onCreate}
          className="rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-2 font-semibold"
        >
          + Crear Usuario
        </button>
      </div>

      {/* Tabla de usuarios */}
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-white/10 bg-black/20">
            <tr>
              <th className="text-left p-4 font-semibold">Nombre</th>
              <th className="text-left p-4 font-semibold">Teléfono</th>
              <th className="text-left p-4 font-semibold">Estado</th>
              <th className="text-left p-4 font-semibold">Roles</th>
              <th className="text-left p-4 font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-white/5 hover:bg-white/5">
                <td className="p-4">{user.full_name}</td>
                <td className="p-4 text-white/60">{user.phone_e164}</td>
                <td className="p-4">
                  <span className={cn(
                    "px-2 py-1 rounded-lg text-xs font-semibold",
                    user.is_active
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-rose-500/20 text-rose-300"
                  )}>
                    {user.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="p-4 text-sm text-white/60">
                  {user.roles.length > 0 ? user.roles.join(', ') : 'Sin roles'}
                </td>
                <td className="p-4">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={() => onResetPin(user)}
                      className="text-xs px-3 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10"
                    >
                      Reset PIN
                    </button>
                    <button
                      onClick={() => onToggleActive(user.id, user.is_active)}
                      className="text-xs px-3 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10"
                    >
                      {user.is_active ? 'Desactivar' : 'Activar'}
                    </button>
                    <button
                      onClick={() => onEditRoles(user)}
                      className="text-xs px-3 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                    >
                      Roles
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && (
          <div className="p-8 text-center text-white/50">
            No se encontraron usuarios
          </div>
        )}
      </div>
    </div>
  )
}

function NotificationsTab() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [deactivatingId, setDeactivatingId] = useState(null)
  const [localErr, setLocalErr] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expanded, setExpanded] = useState({})
  const [confirmTarget, setConfirmTarget] = useState(null)

  const [formData, setFormData] = useState({
    title: '',
    message: '',
    action_url: '',
    expires_in_days: 7,
  })

  useEffect(() => {
    loadNotifications()
  }, [])

  useEffect(() => {
    if (!successMsg) return
    const t = setTimeout(() => setSuccessMsg(''), 2600)
    return () => clearTimeout(t)
  }, [successMsg])

  function statusOf(item) {
    if (!item.is_active) return 'DISABLED'
    if (item.expires_at && new Date(item.expires_at).getTime() <= Date.now()) return 'EXPIRED'
    return 'ACTIVE'
  }

  function statusChip(status) {
    if (status === 'ACTIVE') {
      return <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-300">ACTIVA</span>
    }
    if (status === 'EXPIRED') {
      return <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-300">EXPIRADA</span>
    }
    return <span className="rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-1 text-[10px] font-semibold text-zinc-300">DESACTIVADA</span>
  }

  function normalizeDays(value) {
    const n = parseInt(value, 10)
    if (Number.isNaN(n)) return 7
    return Math.min(30, Math.max(1, n))
  }

  function formatDate(value) {
    if (!value) return '-'
    return new Date(value).toLocaleString()
  }

  async function loadNotifications() {
    setLoading(true)
    setLocalErr('')
    try {
      const data = await apiFetch('/admin/notifications?include_inactive=true&limit=200')
      setItems(data.items || [])
    } catch (err) {
      setLocalErr(err.message || 'No se pudo cargar notificaciones.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setLocalErr('')
    setSuccessMsg('')

    const title = formData.title.trim()
    const message = formData.message.trim()
    if (!title || !message) return

    setSubmitting(true)
    try {
      await apiFetch('/admin/notifications', {
        method: 'POST',
        body: {
          title,
          message,
          action_url: formData.action_url.trim() ? formData.action_url.trim() : null,
          expires_in_days: normalizeDays(formData.expires_in_days),
        },
      })

      setSuccessMsg('Notificacion creada')
      setFormData((prev) => ({
        ...prev,
        title: '',
        message: '',
        action_url: '',
      }))
      await loadNotifications()
    } catch (err) {
      setLocalErr(err.message || 'No se pudo crear la notificacion.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeactivate(notificationId) {
    setDeactivatingId(notificationId)
    setLocalErr('')
    setSuccessMsg('')
    try {
      await apiFetch(`/admin/notifications/${notificationId}`, { method: 'DELETE' })
      setSuccessMsg('Notificacion desactivada')
      setConfirmTarget(null)
      await loadNotifications()
    } catch (err) {
      setLocalErr(err.message || 'No se pudo desactivar la notificacion.')
    } finally {
      setDeactivatingId(null)
    }
  }

  const filteredItems = items.filter((item) => {
    if (statusFilter === 'all') return true
    return statusOf(item).toLowerCase() === statusFilter
  })

  const previewDays = normalizeDays(formData.expires_in_days)

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
        Esta tab administra solo notificaciones informativas globales.
        Las de votos pendientes son dinamicas y se generan automaticamente.
      </div>

      {localErr && (
        <Banner kind="error" title="Error" onClose={() => setLocalErr('')}>
          {localErr}
        </Banner>
      )}

      {successMsg && (
        <Banner kind="success" title="Listo" onClose={() => setSuccessMsg('')}>
          {successMsg}
        </Banner>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <h3 className="text-lg font-semibold">Crear Notificacion</h3>
          <p className="mt-1 text-sm text-white/60">Se mostrara en la campana de todos los usuarios.</p>

          <form onSubmit={handleCreate} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-2">Titulo</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                required
                maxLength={140}
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Mensaje</label>
              <textarea
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                required
                maxLength={1200}
                rows={4}
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Action URL (opcional)</label>
              <input
                type="url"
                value={formData.action_url}
                onChange={(e) => setFormData({ ...formData, action_url: e.target.value })}
                placeholder="https://..."
                maxLength={500}
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Expira en (dias)</label>
              <input
                type="number"
                min={1}
                max={30}
                value={formData.expires_in_days}
                onChange={(e) => setFormData({ ...formData, expires_in_days: e.target.value })}
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
              />
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-white/50">Preview</div>
              <div className="mt-2 rounded-xl border border-white/10 bg-black/30 p-3">
                <div className="text-sm font-semibold text-white">{formData.title.trim() || 'Titulo de ejemplo'}</div>
                <div className="mt-1 whitespace-pre-line text-xs text-white/70">
                  {formData.message.trim() || 'Mensaje de ejemplo para la campana.'}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {formData.action_url.trim() && (
                    <span className="rounded-lg border border-amber-400/30 bg-amber-500/20 px-2 py-1 text-[11px] font-semibold text-amber-200">
                      Abrir
                    </span>
                  )}
                  <span className="text-[11px] text-white/50">Expira en {previewDays} dias</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="submit"
                disabled={submitting || !formData.title.trim() || !formData.message.trim()}
                className="rounded-xl bg-emerald-500 px-4 py-3 font-semibold hover:bg-emerald-600 disabled:opacity-40"
              >
                {submitting ? 'Creando...' : 'Crear'}
              </button>
              <button
                type="button"
                onClick={() => setFormData({ title: '', message: '', action_url: '', expires_in_days: 7 })}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-semibold hover:bg-white/10"
              >
                Limpiar
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold">Historial</h3>
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/20"
              >
                <option value="all">Todas</option>
                <option value="active">Activas</option>
                <option value="expired">Expiradas</option>
                <option value="disabled">Desactivadas</option>
              </select>
              <button
                onClick={loadNotifications}
                disabled={loading}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10 disabled:opacity-40"
              >
                {loading ? 'Cargando...' : 'Actualizar'}
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {!loading && filteredItems.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-black/20 p-6 text-center text-sm text-white/50">
                No hay notificaciones en este filtro.
              </div>
            )}

            {filteredItems.map((item) => {
              const status = statusOf(item)
              const isExpanded = !!expanded[item.id]
              const longMessage = (item.message || '').length > 120
              const messagePreview = isExpanded || !longMessage ? item.message : `${item.message.slice(0, 120)}...`

              return (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-white">{item.title}</div>
                      <div className="mt-1 whitespace-pre-line text-xs text-white/70">{messagePreview}</div>
                      {longMessage && (
                        <button
                          onClick={() => setExpanded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                          className="mt-1 text-[11px] font-semibold text-amber-300 hover:text-amber-200"
                        >
                          {isExpanded ? 'Ver menos' : 'Ver mas'}
                        </button>
                      )}
                    </div>
                    {statusChip(status)}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/50">
                    <span>Creada: {formatDate(item.created_at)}</span>
                    <span>Expira: {formatDate(item.expires_at)}</span>
                    {item.action_url && (
                      <a href={item.action_url} target="_blank" rel="noreferrer" className="text-amber-300 hover:text-amber-200">
                        Link
                      </a>
                    )}
                  </div>

                  <div className="mt-3">
                    {item.is_active ? (
                      <button
                        onClick={() => setConfirmTarget(item)}
                        disabled={deactivatingId === item.id}
                        className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
                      >
                        {deactivatingId === item.id ? 'Desactivando...' : 'Desactivar'}
                      </button>
                    ) : (
                      <span className="text-xs text-white/40">Sin acciones</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <Modal
        isOpen={!!confirmTarget}
        onClose={() => setConfirmTarget(null)}
        title="Desactivar notificacion"
      >
        <div className="space-y-4">
          <p className="text-white/80">
            ¿Seguro que queres desactivar esta notificacion?
          </p>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-sm font-semibold text-white">{confirmTarget?.title}</div>
            <div className="mt-1 whitespace-pre-line text-xs text-white/70">{confirmTarget?.message}</div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => handleDeactivate(confirmTarget?.id)}
              disabled={!confirmTarget || !!deactivatingId}
              className="flex-1 rounded-xl bg-rose-500 px-4 py-3 font-semibold hover:bg-rose-600 disabled:opacity-40"
            >
              Confirmar
            </button>
            <button
              onClick={() => setConfirmTarget(null)}
              className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-semibold hover:bg-white/10"
            >
              Cancelar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function AuditoriaTab({ logs, filters, setFilters, busy, onRefresh }) {
  return (
    <div className="space-y-6">
      {/* Filtros */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={filters.action}
          onChange={(e) => setFilters({ ...filters, action: e.target.value })}
          placeholder="Filtrar por acción..."
          className="flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
        />
        <button
          onClick={onRefresh}
          disabled={busy}
          className="rounded-xl bg-white/10 hover:bg-white/20 px-4 py-2 font-semibold disabled:opacity-50"
        >
          {busy ? 'Cargando...' : 'Actualizar'}
        </button>
      </div>

      {/* Tabla de logs */}
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-white/10 bg-black/20">
            <tr>
              <th className="text-left p-3 font-semibold">Fecha</th>
              <th className="text-left p-3 font-semibold">Actor</th>
              <th className="text-left p-3 font-semibold">Acción</th>
              <th className="text-left p-3 font-semibold">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-white/5 hover:bg-white/5">
                <td className="p-3 text-white/60">
                  {new Date(log.created_at).toLocaleString()}
                </td>
                <td className="p-3">{log.actor_name || log.actor_user_id.slice(0, 8)}</td>
                <td className="p-3 text-emerald-300">{log.action}</td>
                <td className="p-3 text-white/50 text-xs font-mono max-w-xs truncate">
                  {JSON.stringify(log.metadata)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {logs.length === 0 && (
          <div className="p-8 text-center text-white/50">
            No hay logs de auditoría
          </div>
        )}
      </div>
    </div>
  )
}

// ==================== FORM COMPONENTS ====================

function CreateEventForm({ onSubmit, busy }) {
  const [formData, setFormData] = useState({
    title: '',
    starts_at: '',
    location_name: ''
  })

  function handleSubmit(e) {
    e.preventDefault()
    onSubmit(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-semibold mb-2">Título</label>
        <input
          type="text"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          data-testid="admin-create-event-title-input"
          required
          className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
        />
      </div>
      <div>
        <label className="block text-sm font-semibold mb-2">Fecha/Hora de inicio</label>
        <input
          type="datetime-local"
          value={formData.starts_at}
          onChange={(e) => setFormData({ ...formData, starts_at: e.target.value })}
          data-testid="admin-create-event-starts-at-input"
          required
          className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
        />
      </div>
      <div>
        <label className="block text-sm font-semibold mb-2">Ubicación</label>
        <input
          type="text"
          value={formData.location_name}
          onChange={(e) => setFormData({ ...formData, location_name: e.target.value })}
          data-testid="admin-create-event-location-input"
          required
          className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
        />
      </div>
      <button
        type="submit"
        disabled={busy}
        data-testid="admin-create-event-submit-btn"
        className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-3 font-semibold disabled:opacity-50"
      >
        {busy ? 'Creando...' : 'Crear Evento'}
      </button>
    </form>
  )
}

function CreateCourtForm({ onSubmit, busy, initialData = null, submitLabel = 'Crear Cancha', testIdPrefix = 'court-form' }) {
  const [formData, setFormData] = useState({
    name: '',
    capacity: 10,
    sort_order: 1,
    is_open: true
  })

  useEffect(() => {
    if (!initialData) {
      setFormData({
        name: '',
        capacity: 10,
        sort_order: 1,
        is_open: true
      })
      return
    }

    setFormData({
      name: initialData.name || '',
      capacity: initialData.capacity ?? 10,
      sort_order: initialData.sort_order ?? 1,
      is_open: initialData.is_open ?? true
    })
  }, [initialData])

  function handleSubmit(e) {
    e.preventDefault()
    onSubmit({
      name: formData.name,
      capacity: Number(formData.capacity),
      sort_order: Number(formData.sort_order),
      is_open: !!formData.is_open
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-semibold mb-2">Nombre</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          data-testid={`${testIdPrefix}-name-input`}
          required
          placeholder="Cancha 1"
          className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
        />
      </div>
      <div>
        <label className="block text-sm font-semibold mb-2">Capacidad</label>
        <input
          type="number"
          value={formData.capacity}
          onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
          data-testid={`${testIdPrefix}-capacity-input`}
          required
          min="1"
          max="50"
          className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
        />
      </div>
      <div>
        <label className="block text-sm font-semibold mb-2">Orden</label>
        <input
          type="number"
          value={formData.sort_order}
          onChange={(e) => setFormData({ ...formData, sort_order: e.target.value })}
          data-testid={`${testIdPrefix}-sort-order-input`}
          required
          min="1"
          className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
        />
      </div>
      <div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={formData.is_open}
            onChange={(e) => setFormData({ ...formData, is_open: e.target.checked })}
            data-testid={`${testIdPrefix}-is-open-input`}
            className="rounded"
          />
          <span className="text-sm">Cancha abierta</span>
        </label>
      </div>
      <button
        type="submit"
        disabled={busy}
        data-testid={`${testIdPrefix}-submit-btn`}
        className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-3 font-semibold disabled:opacity-50"
      >
        {busy ? 'Guardando...' : submitLabel}
      </button>
    </form>
  )
}

function CreateUserForm({ onSubmit, busy }) {
  const [formData, setFormData] = useState({
    full_name: '',
    phone: '',
    email: '',
    pin: '',
    roles: []
  })

  function toggleRole(role) {
    setFormData(prev => ({
      ...prev,
      roles: prev.roles.includes(role)
        ? prev.roles.filter(r => r !== role)
        : [...prev.roles, role]
    }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    const payload = { ...formData }
    if (payload.roles.length === 0) delete payload.roles
    onSubmit(payload)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-semibold mb-2">Nombre completo</label>
        <input
          type="text"
          value={formData.full_name}
          onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
          required
          className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
        />
      </div>
      <div>
        <label className="block text-sm font-semibold mb-2">Teléfono</label>
        <input
          type="tel"
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          required
          placeholder="11 1234 5678"
          className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
        />
      </div>
      <div>
        <label className="block text-sm font-semibold mb-2">Email (opcional)</label>
        <input
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
        />
      </div>
      <div>
        <label className="block text-sm font-semibold mb-2">PIN (4 o 6 dígitos, opcional)</label>
        <input
          type="text"
          value={formData.pin}
          onChange={(e) => setFormData({ ...formData, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
          placeholder="1234"
          inputMode="numeric"
          className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
        />
      </div>
      <div>
        <label className="block text-sm font-semibold mb-2">Roles (opcional)</label>
        <div className="flex gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.roles.includes('admin')}
              onChange={() => toggleRole('admin')}
              className="w-4 h-4 rounded border-white/20 bg-black/20 text-emerald-500 focus:ring-emerald-500/30"
            />
            <span className="text-sm">Admin</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.roles.includes('super_admin')}
              onChange={() => toggleRole('super_admin')}
              className="w-4 h-4 rounded border-white/20 bg-black/20 text-emerald-500 focus:ring-emerald-500/30"
            />
            <span className="text-sm">Super Admin</span>
          </label>
        </div>
        <p className="text-xs text-white/40 mt-1">Sin roles = usuario regular (jugador)</p>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-3 font-semibold disabled:opacity-50"
      >
        {busy ? 'Creando...' : 'Crear Usuario'}
      </button>
    </form>
  )
}

function ResetPinForm({ user, onSubmit, busy }) {
  const [pin, setPin] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (!/^\d{4}$|^\d{6}$/.test(pin)) {
      alert('PIN debe ser de 4 o 6 dígitos')
      return
    }
    onSubmit(pin)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-white/70">
        Resetear PIN para <strong>{user?.full_name}</strong>
      </p>
      <div>
        <label className="block text-sm font-semibold mb-2">Nuevo PIN (4 o 6 dígitos)</label>
        <input
          type="text"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          required
          placeholder="1234"
          inputMode="numeric"
          className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
        />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-3 font-semibold disabled:opacity-50"
      >
        {busy ? 'Guardando...' : 'Resetear PIN'}
      </button>
    </form>
  )
}

function EditRolesForm({ user, onSubmit, busy }) {
  const [selectedRoles, setSelectedRoles] = useState(user?.roles || [])

  function toggleRole(role) {
    setSelectedRoles(prev =>
      prev.includes(role)
        ? prev.filter(r => r !== role)
        : [...prev, role]
    )
  }

  function handleSubmit(e) {
    e.preventDefault()
    onSubmit(selectedRoles)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-white/70">
        Editar roles de <strong>{user?.full_name}</strong>
      </p>
      <div className="space-y-3">
        <label className="flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-black/20 cursor-pointer hover:bg-white/5">
          <input
            type="checkbox"
            checked={selectedRoles.map(r => r.toLowerCase()).includes('admin')}
            onChange={() => toggleRole('admin')}
            className="w-4 h-4 rounded border-white/20 bg-black/20 text-emerald-500 focus:ring-emerald-500/30"
          />
          <div>
            <span className="text-sm font-semibold">Admin</span>
            <p className="text-xs text-white/40">Puede gestionar eventos, canchas y usuarios</p>
          </div>
        </label>
        <label className="flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-black/20 cursor-pointer hover:bg-white/5">
          <input
            type="checkbox"
            checked={selectedRoles.map(r => r.toLowerCase()).includes('super_admin')}
            onChange={() => toggleRole('super_admin')}
            className="w-4 h-4 rounded border-white/20 bg-black/20 text-emerald-500 focus:ring-emerald-500/30"
          />
          <div>
            <span className="text-sm font-semibold">Super Admin</span>
            <p className="text-xs text-white/40">Acceso completo, puede asignar super_admin a otros</p>
          </div>
        </label>
      </div>
      <p className="text-xs text-white/40">Sin roles seleccionados = usuario regular (jugador)</p>
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-3 font-semibold disabled:opacity-50"
      >
        {busy ? 'Guardando...' : 'Guardar Roles'}
      </button>
    </form>
  )
}



