import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader, Panel, TablePagination, Toolbar } from "@/components/shared/ui-kit";
import { useAuth } from "@/lib/auth";
import type { DbCustomer } from "@/lib/db-types";
import { createCustomer, deleteCustomer, listCustomers, updateCustomer } from "@/lib/customers-api";

type CustomerFormState = {
  name: string;
  company: string;
  phone: string;
  email: string;
  installedBase: string;
  notes: string;
};

const defaultForm: CustomerFormState = {
  name: "",
  company: "",
  phone: "",
  email: "",
  installedBase: "",
  notes: "",
};

export const Route = createFileRoute("/customers")({
  head: () => ({
    meta: [
      { title: "Customers — EnerTech Engage" },
      { name: "description", content: "Accounts, contacts, installed base and lifetime value across the EnerTech portfolio." },
      { property: "og:title", content: "Customers — EnerTech Engage" },
      { property: "og:description", content: "Accounts, contacts, installed base and lifetime value across the EnerTech portfolio." },
    ],
  }),
  component: Page,
});

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

function installedBaseLabel(customer: DbCustomer) {
  const value = customer.metadata?.installedBase;
  return typeof value === "string" && value.trim() ? value : "—";
}

function formFromCustomer(customer: DbCustomer): CustomerFormState {
  return {
    name: customer.name,
    company: customer.company || "",
    phone: customer.phone || "",
    email: customer.email || "",
    installedBase: installedBaseLabel(customer) === "—" ? "" : installedBaseLabel(customer),
    notes: customer.notes || "",
  };
}

function Page() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const orgId = profile?.org.id;
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<DbCustomer | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<DbCustomer | null>(null);
  const [form, setForm] = useState<CustomerFormState>(defaultForm);

  const customersQuery = useQuery({
    queryKey: ["customers", orgId],
    enabled: Boolean(orgId),
    queryFn: () => listCustomers(orgId!),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Your profile is still loading");
      if (!form.name.trim()) throw new Error("Primary contact name is required");
      const payload = {
        orgId,
        name: form.name,
        company: form.company,
        phone: form.phone,
        email: form.email,
        installedBase: form.installedBase,
        notes: form.notes,
      };
      return editingCustomer ? updateCustomer(editingCustomer.id, payload) : createCustomer(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customers", orgId] });
      toast.success(editingCustomer ? "Customer updated" : "Customer created");
      setDialogOpen(false);
      setEditingCustomer(null);
      setForm(defaultForm);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not save customer");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (customerId: string) => deleteCustomer(customerId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customers", orgId] });
      toast.success("Customer deleted");
      setCustomerToDelete(null);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not delete customer");
    },
  });

  const filteredCustomers = useMemo(() => {
    const items = customersQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((customer) =>
      [customer.name, customer.company, customer.email, customer.phone, installedBaseLabel(customer)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [customersQuery.data, search]);

  const openCreate = () => {
    setEditingCustomer(null);
    setForm(defaultForm);
    setDialogOpen(true);
  };

  const openEdit = (customer: DbCustomer) => {
    setEditingCustomer(customer);
    setForm(formFromCustomer(customer));
    setDialogOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Customers"
        description="Accounts, contacts, installed base and lifetime value across the EnerTech portfolio."
        actions={<Button size="sm" onClick={openCreate}><Plus className="size-4" /> Add customer</Button>}
      />
      <div className="space-y-4 p-6">
        <Panel bodyClassName="p-0">
          <Toolbar
            placeholder="Search customers…"
            value={search}
            onChange={setSearch}
            right={<Button size="sm" variant="outline" onClick={() => toast("CSV export comes next")}>Export CSV</Button>}
          />

          {customersQuery.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading customers…</div>
          ) : filteredCustomers.length === 0 ? (
            <div className="p-4"><EmptyState title={search ? "No matching customers" : "No customers yet"} description={search ? "Try a different search term." : "Add your first customer to start building the CRM."} /></div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>{["Company","Primary contact","Phone","Email","Installed base","Created","Actions"].map((h) => <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredCustomers.map((customer) => (
                      <tr key={customer.id} className="hover:bg-secondary/40">
                        <td className="px-4 py-3 font-medium whitespace-nowrap">{customer.company || "—"}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{customer.name}</td>
                        <td className="num px-4 py-3 text-muted-foreground whitespace-nowrap">{customer.phone || "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{customer.email || "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{installedBaseLabel(customer)}</td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDate(customer.created_at)}</td>
                        <td className="px-4 py-3"><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => openEdit(customer)}><Pencil className="size-4" /> Edit</Button><Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setCustomerToDelete(customer)}><Trash2 className="size-4" /> Delete</Button></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination total={filteredCustomers.length} shown={filteredCustomers.length} />
            </>
          )}
        </Panel>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setEditingCustomer(null); setForm(defaultForm); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCustomer ? "Edit customer" : "Add customer"}</DialogTitle>
            <DialogDescription>{editingCustomer ? "Update this customer in Supabase." : "Create a real customer record in Supabase."}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="customer-name">Primary contact</Label><Input id="customer-name" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} placeholder="Customer name" /></div>
            <div className="space-y-2"><Label htmlFor="customer-company">Company</Label><Input id="customer-company" value={form.company} onChange={(e) => setForm((s) => ({ ...s, company: e.target.value }))} placeholder="Company name" /></div>
            <div className="space-y-2"><Label htmlFor="customer-phone">Phone</Label><Input id="customer-phone" value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} placeholder="Phone number" /></div>
            <div className="space-y-2"><Label htmlFor="customer-email">Email</Label><Input id="customer-email" type="email" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} placeholder="Email address" /></div>
            <div className="space-y-2"><Label htmlFor="customer-installed">Installed base</Label><Input id="customer-installed" value={form.installedBase} onChange={(e) => setForm((s) => ({ ...s, installedBase: e.target.value }))} placeholder="UPS models / batteries / AMC" /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="customer-notes">Notes</Label><Textarea id="customer-notes" value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} placeholder="Relationship notes, service history, or account context" /></div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saveMutation.isPending}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>{saveMutation.isPending ? "Saving…" : editingCustomer ? "Update customer" : "Create customer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(customerToDelete)} onOpenChange={(open) => !open && setCustomerToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete customer?</AlertDialogTitle>
            <AlertDialogDescription>{customerToDelete ? `This will permanently delete ${customerToDelete.name}.` : "This action cannot be undone."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(e) => { e.preventDefault(); if (customerToDelete) deleteMutation.mutate(customerToDelete.id); }}>{deleteMutation.isPending ? "Deleting…" : "Delete"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
