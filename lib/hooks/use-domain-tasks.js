/**
 * [Claude-authored file]
 * Created: 2026-02-22 | Model: claude-opus-4-6
 * Task: Custom hook managing task domain state and task grouping logic
 * Prompt summary: "extract task/domain state and grouping logic from DashboardApp into useDomainTasks hook"
 */
import { useState, useCallback } from "react";

// ------------------------------------------------------------------------------------------
function formatDateKey(dateValue) {
  const date = new Date(dateValue);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ------------------------------------------------------------------------------------------
function groupOpenTasksByDate(tasks) {
  const grouped = {};
  tasks.forEach(task => {
    if (task.completedAt || task.dismissedAt) return;
    const dateSource = task.startAt || task.deadline;
    if (!dateSource) return;
    const key = formatDateKey(dateSource);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(task);
  });
  return grouped;
}

// ------------------------------------------------------------------------------------------
function groupCompletedTasksByDate(tasks) {
  const grouped = {};
  tasks.forEach(task => {
    if (!task.completedAt) return;
    const key = formatDateKey(task.completedAt);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(task);
  });
  return grouped;
}

// ------------------------------------------------------------------------------------------
// [Claude] Task: custom hook for task domain state and grouping logic
// Prompt: "extract task/domain state and grouping logic from DashboardApp into useDomainTasks hook"
// Date: 2026-02-22 | Model: claude-opus-4-6
export default function useDomainTasks() {
  const [taskDomains, setTaskDomains] = useState([]);
  const [activeTaskDomain, setActiveTaskDomain] = useState(null);
  const [tasksFetchedAt, setTasksFetchedAt] = useState(null);
  const [openTasks, setOpenTasks] = useState({});
  const [completedTasks, setCompletedTasks] = useState({});

  const initializeDomainTasks = useCallback((initResult) => {
    if (!initResult) return;
    setTaskDomains(initResult.taskDomains || []);
    setActiveTaskDomain(initResult.activeTaskDomain || null);
    const tasks = initResult.tasks || [];
    setOpenTasks(groupOpenTasksByDate(tasks));
    setCompletedTasks(groupCompletedTasksByDate(tasks));
    setTasksFetchedAt(Date.now());
  }, []);

  const handleDomainChange = useCallback((newDomains, newActiveDomain, taskData) => {
    if (newDomains) {
      setTaskDomains(newDomains);
    }
    if (newActiveDomain) {
      setActiveTaskDomain(newActiveDomain);
    }
    if (taskData) {
      const tasks = taskData.tasks || [];
      setOpenTasks(groupOpenTasksByDate(tasks));
      setCompletedTasks(groupCompletedTasksByDate(tasks));
      setTasksFetchedAt(Date.now());
    }
  }, []);

  const buildAgendaTasksByDate = useCallback((currentDateIso) => {
    const currentDate = currentDateIso ? new Date(currentDateIso) : new Date();
    const todayKey = formatDateKey(currentDate);

    // Flatten openTasks back into an array, then filter+sort for agenda display
    const allOpenTasks = Object.values(openTasks).flat();
    const pendingTasks = allOpenTasks
      .filter(task => task.startAt)
      .sort((a, b) => a.startAt - b.startAt);

    console.log(`Agenda: reviewed ${ allOpenTasks.length } open tasks`, allOpenTasks);
    console.log(`${ pendingTasks.length } relevant (with startAt)`, pendingTasks);

    const groupedByDate = {};
    pendingTasks.forEach(task => {
      const dateKey = formatDateKey(task.startAt);
      if (!groupedByDate[dateKey]) groupedByDate[dateKey] = [];
      groupedByDate[dateKey].push(task);
    });

    const sortedDateKeys = Object.keys(groupedByDate).sort();
    const upcomingDateKeys = sortedDateKeys.filter(dateKey => dateKey > todayKey);
    const olderDateKeys = sortedDateKeys.filter(dateKey => dateKey < todayKey);
    const orderedDateKeys = [todayKey, ...upcomingDateKeys, ...olderDateKeys];

    const agendaTasksByDate = {};
    orderedDateKeys.forEach(dateKey => {
      agendaTasksByDate[dateKey] = groupedByDate[dateKey] || [];
    });
    return agendaTasksByDate;
  }, [openTasks]);

  return {
    taskDomains,
    activeTaskDomain,
    tasksFetchedAt,
    openTasks,
    completedTasks,
    initializeDomainTasks,
    handleDomainChange,
    buildAgendaTasksByDate
  };
}
