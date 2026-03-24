// tests/components/DataTable.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataTable } from '@/components/common/DataTable';

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
  }),
}));

describe('DataTable', () => {
  const mockColumns = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => row.getValue('name'),
    },
    {
      accessorKey: 'value',
      header: 'Value',
      cell: ({ row }) => row.getValue('value'),
    },
  ];

  const mockData = [
    { name: 'Item 1', value: 100 },
    { name: 'Item 2', value: 200 },
    { name: 'Item 3', value: 300 },
  ];

  it('should render table with data', () => {
    render(
      <DataTable
        columns={mockColumns}
        data={mockData}
        sorting={[]}
        setSorting={vi.fn()}
        columnFilters={[]}
        setColumnFilters={vi.fn()}
        pagination={{ pageIndex: 0, pageSize: 10 }}
        setPagination={vi.fn()}
      />
    );

    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
    expect(screen.getByText('Item 3')).toBeInTheDocument();
  });

  it('should render empty state when no data', () => {
    render(
      <DataTable
        columns={mockColumns}
        data={[]}
        sorting={[]}
        setSorting={vi.fn()}
        columnFilters={[]}
        setColumnFilters={vi.fn()}
        pagination={{ pageIndex: 0, pageSize: 10 }}
        setPagination={vi.fn()}
      />
    );

    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('should render column headers', () => {
    render(
      <DataTable
        columns={mockColumns}
        data={mockData}
        sorting={[]}
        setSorting={vi.fn()}
        columnFilters={[]}
        setColumnFilters={vi.fn()}
        pagination={{ pageIndex: 0, pageSize: 10 }}
        setPagination={vi.fn()}
      />
    );

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Value')).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(
      <DataTable
        columns={mockColumns}
        data={mockData}
        sorting={[]}
        setSorting={vi.fn()}
        columnFilters={[]}
        setColumnFilters={vi.fn()}
        pagination={{ pageIndex: 0, pageSize: 10 }}
        setPagination={vi.fn()}
        className="custom-class"
      />
    );

    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });
});
