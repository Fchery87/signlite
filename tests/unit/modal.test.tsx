import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../../src/components/ui';

describe('modal', () => {
  it('traps focus and closes on escape', { timeout: 10000 }, async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal open title="Modal title" onClose={onClose}>
        <button>First</button>
        <button>Second</button>
      </Modal>
    );

    expect(screen.getByRole('button', { name: 'Close modal' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
