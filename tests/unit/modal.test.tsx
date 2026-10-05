import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Modal } from '../../src/components/ui';

describe('modal', () => {
  it('traps focus in both Tab directions, skips a disabled control, and restores the opener', { timeout: 10000 }, async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Opener</button>
          <Modal open={open} title="Modal title" onClose={() => setOpen(false)}>
            <button>First</button>
            <button disabled>Save</button>
            <button>Second</button>
          </Modal>
        </>
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Opener' }));

    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Second' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.tab();
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Second' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Opener' })).toHaveFocus();
  });

  it('lets only the inner dialog close on Escape when dialogs are nested', async () => {
    const user = userEvent.setup();
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(
      <Modal open title="Outer" onClose={outerClose}>
        <button>Outer action</button>
        <Modal open title="Inner" onClose={innerClose}>
          <button>Inner action</button>
        </Modal>
      </Modal>
    );
    screen.getByRole('button', { name: 'Inner action' }).focus();
    await user.keyboard('{Escape}');
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });
});
